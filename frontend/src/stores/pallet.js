import { defineStore } from 'pinia'
import { ref, computed, triggerRef } from 'vue'
import { auth, db, request } from '@/lib/api.js'
import { isAdmin as checkIsAdmin } from '@/config'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'

/** Safe deep clone — избегает ошибок при circular references */
function safeDeepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)) }
  catch { return structuredClone(obj) }
}

/**
 * Store для управления паллетами (server-first).
 * Данные хранятся на сервере. localStorage — только сессия + UI.
 */
export const usePalletStore = defineStore('pallet', () => {
  // Массив собранных паллетов
  const pallets = ref([])
  // Текущий активный паллет
  const currentPallet = ref(null)
  // Доступные короба для добавления в паллет (finished boxes)
  const availableBoxes = ref([])
  // Доступные отдельные товары для добавления
  const availableSeparateItems = ref([])
  // Статус синхронизации
  const isSyncing = ref(false)
  const syncError = ref(null)
  // История действий для undo (максимум 50)
  const actionHistory = ref([])

  /** Явный trigger для форсированного обновления computed properties в UI */
  const palletItemsVersion = ref(0)

  function triggerPalletItemsUpdate() {
    palletItemsVersion.value++
    // Принудительно обновляем ref чтобы все computed properties пересчитались
    triggerRef(palletItemsVersion)
  }

  /* ============================================================
  Вычисляемые
  ============================================================ */
  const canUndo = computed(() => currentPallet.value && actionHistory.value.length > 0)
  const totalPallets = computed(() => pallets.value.length)
  const currentPalletItemCount = computed(() => currentPallet.value ? currentPallet.value.items.length : 0)
  const hasAvailableBoxes = computed(() => availableBoxes.value.length > 0)
  const hasAvailableSeparateItems = computed(() => availableSeparateItems.value.length > 0)

  /* ============================================================
  Загрузка данных с сервера
  ============================================================ */
  async function loadPallets() {
    try {
      if (!navigator.onLine) return []
      const result = await db.pallets.getAll()
      if (result.error) return []

      pallets.value = (result.data || [])
        .filter(p => p.status === 'finished')
        .map(p => ({
          id: p.id,
          number: p.pallet_number || 0,
          name: p.name || `Паллет ${p.pallet_number}`,
          collector_id: p.collector_id,
          seal: p.seal || null,
          status: p.status,
          createdAt: p.created_at,
          finishedAt: p.finished_at,
          items: [],
        }))

      // BUG-240 fix: параллельная загрузка items через Promise.all
      await Promise.all(pallets.value.map(async (pallet) => {
        if (pallet.status === 'finished') {
          try {
            const itemsResult = await db.palletItems.getByPalletId(pallet.id)
            const allItems = itemsResult.data || []
            pallet.items = allItems
            pallet.boxCount = allItems.filter(i => i.source_type === 'box').length
            pallet.separateItemCount = allItems.filter(i => i.source_type === 'separate_item').length
            pallet.inlineCount = allItems.filter(i => i.source_type === 'pallet' || i.source_type === 'inline').length
          } catch {
            // ignore
          }
        }
      }))
      return pallets.value
    } catch {
      return []
    }
  }

  async function loadAvailableBoxes() {
    try {
      if (!navigator.onLine) { availableBoxes.value = []; return [] }
      const result = await db.boxes.getAll()
      if (result.error) { availableBoxes.value = []; return [] }

      const finishedBoxes = (result.data || []).filter(b => b.status === 'finished')
      // Lazy load: не грузим items для всех доступных коробов — только базовые данные
      availableBoxes.value = finishedBoxes.map(box => ({
        id: box.id,
        number: box.box_number || 0,
        name: box.name || `Микс ${box.box_number}`,
        collector_id: box.collector_id,
        itemCount: null,    // загружается при клике на короб
        itemsLoaded: false,
        items: []           // полная загрузка при выборе короба из списка
      }))
      return availableBoxes.value
    } catch {
      availableBoxes.value = []
      return []
    }
  }

  /** Обновить items конкретного доступного короба (lazy load) */
  async function refreshAvailableBoxItems(boxId) {
    const box = availableBoxes.value.find(b => b.id === boxId)
    if (!box || box.itemsLoaded) return box

    try {
      if (!navigator.onLine) return box

      const itemsResult = await db.boxItems.getByBoxId(boxId)
      const items = (itemsResult.data || []).map(item => ({
        number: item.barcode,
        name: item.name,
        article: item.brand || '',
        comment: item.comment || '',
        scannedAt: item.created_at
      }))

      box.items = items
      box.itemCount = items.length
      box.itemsLoaded = true
      return box
    } catch {
      box.itemCount = 0
      return box
    }
  }

  async function loadAvailableSeparateItems() {
    try {
      if (!navigator.onLine) { availableSeparateItems.value = []; return [] }
      const result = await db.separateItems.getAll()
      if (result.error) { availableSeparateItems.value = []; return [] }

      availableSeparateItems.value = (result.data || []).map(item => ({
        id: item.id,
        number: item.barcode,
        name: item.name,
        article: item.brand || '',
        comment: item.comment || ''
      }))
      return availableSeparateItems.value
    } catch {
      availableSeparateItems.value = []
      return []
    }
  }

  async function loadActivePallet() {
    try {
      if (!navigator.onLine) return null
      const result = await db.pallets.getAll()
      if (result.error) return null

      // Убрали localStorage fallback — только сервер
      const activePallets = (result.data || []).filter(p => p.status === 'active')
      if (activePallets.length === 0) return null

      const { useCollectorStore } = await import('@/stores/collector')
      const collectorStore = useCollectorStore()
      const myPallets = activePallets.filter(p => p.collector_id === collectorStore.employeeId)
      myPallets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const myPallet = myPallets[0] || null

      // BUG-237 fix: не загружаем паллет если currentPallet уже существует
      if (myPallet && currentPallet.value && currentPallet.value.backendId === myPallet.id) {
        return currentPallet.value
      }

      if (!myPallet) {
        console.log('⚠️ loadActivePallet: нет своих активных паллетов для employeeId', collectorStore.employeeId)
        return null
      }
      return loadActivePalletById(myPallet, result.data)
    } catch (err) {
      console.error('❌ loadActivePallet error:', err)
      return null
    }
  }

  async function loadActivePalletById(pallet, allData) {
    let serverItems = []
    try {
      const itemsResult = await db.palletItems.getByPalletId(pallet.id)
      if (itemsResult?.data) {
        console.log('🔍 loadActivePalletById raw data:', itemsResult.data.length, 'items')
        
        // Разделяем box items и остальные
        const boxItems = itemsResult.data.filter(i => i.source_type === 'box')
        const otherItems = itemsResult.data.filter(i => i.source_type !== 'box')
        
        // Загружаем items для каждого короба
        for (const boxRef of boxItems) {
          try {
            const boxResult = await db.boxes.getById(boxRef.source_id)
            if (boxResult?.data) {
              const boxItemsResult = await db.boxItems.getByBoxId(boxRef.source_id)
              const boxItemsList = boxItemsResult?.data || []
              
              const undoId = crypto.randomUUID ? crypto.randomUUID() : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
              serverItems.push({
                source_type: 'box',
                source_id: boxRef.source_id,
                order_num: boxResult.data.box_number || 0,
                _full_data: boxItemsList.length > 0 ? { items: boxItemsList } : null,
                _undoId: undoId,
                _boxNumber: boxResult.data.box_number || 0,
                _boxName: boxResult.data.name || `Микс ${boxResult.data.box_number}`,
                _boxItemCount: boxItemsList.length
              })
            }
          } catch (err) {
            console.error('Ошибка загрузки короба из паллета:', boxRef.source_id, err)
          }
        }
        
        // Обрабатываем non-box items
        serverItems = serverItems.concat(
          otherItems
            .map(i => {
              const isTimestamp = typeof i.source_id === 'number' || 
                                  (typeof i.source_id === 'string' && !isNaN(Number(i.source_id)) && Number(i.source_id) > 1700000000000)
              
              if (isTimestamp && (!i.item_name || i.item_name.trim() === '') && !i.item_barcode) return null

              const name = (i.item_name && i.item_name.trim()) ? i.item_name : `Товар ${i.source_id}`
              return {
                source_type: i.source_type === 'pallet' || i.source_type === 'inline' ? 'pallet' : i.source_type,
                source_id: i.source_id,
                originalSourceType: i.source_type,
                barcode: i.item_barcode || '',
                name: name,
                article: (i.item_brand && i.item_brand.trim()) ? i.item_brand : '',
                comment: (i.item_comment && i.item_comment.trim()) ? i.item_comment : '',
                scannedAt: i.scanned_at || ''
              }
            })
            .filter(Boolean)
        )
        
        console.log('✅ loadActivePalletById loaded:', serverItems.length, 'items')
      }
    } catch {
      // ignore
    }

    // Убрали TTL removed barcodes — duplicate check только in-memory при добавлении
    currentPallet.value = {
      id: pallet.id,
      number: pallet.pallet_number || 0,
      name: `Паллет ${pallet.pallet_number}`,
      createdAt: pallet.created_at,
      backendId: pallet.id,
      status: 'active',
      items: serverItems
    }
    return currentPallet.value
  }

  async function loadAllActivePallets() {
    try {
      if (!navigator.onLine) return []
      const result = await db.pallets.getAll()
      if (result.error) return []

      const activePallets = (result.data || []).filter(p => p.status === 'active')
      // BUG-236 fix: не очищаем currentPallet если он создан локально и ещё не синхронизирован
      if (currentPallet.value && currentPallet.value.backendId && !activePallets.some(p => p.id === currentPallet.value.id)) {
        console.log('🗑️ Stale currentPallet удалён (не найден на сервере)')
        currentPallet.value = null
      }

      const palletsWithItems = await Promise.all(activePallets.map(async (pallet) => {
        let serverItems = []
        try {
          const itemsResult = await db.palletItems.getByPalletId(pallet.id)
          if (itemsResult?.data) {
            console.log('🔍 loadAllActivePallets raw data:', itemsResult.data.length, 'items')
            console.log('📋 Raw sample:', JSON.stringify(itemsResult.data[0]))
            serverItems = itemsResult.data
              .filter(i => i.source_type !== 'box')
              .map(i => {
                // Backend возвращает поля с префиксом item_ для pallet/inline items
                const isTimestamp = typeof i.source_id === 'number' ? (
                  String(i.source_id).length >= 13 &&
                  !isNaN(Number(i.source_id)) &&
                  Number(i.source_id) > 1700000000000
                ) : (
                  typeof i.source_id === 'string' && /^\d{13,}$/.test(i.source_id) && !isNaN(Number(i.source_id)) && Number(i.source_id) > 1700000000000
                )

                // Не отбрасываем товары с numeric source_id если есть item_barcode (это barcode товара!)
                const name = (i.item_name && i.item_name.trim()) ? i.item_name : null

                if (isTimestamp && !name && !i.item_barcode) return null

                return {
                  source_type: i.source_type === 'pallet' || i.source_type === 'inline' ? 'pallet' : i.source_type,
                  source_id: i.source_id,
                  barcode: i.item_barcode || '',
                  name: name || `Товар ${i.source_id}`,
                  article: (i.item_brand && i.item_brand.trim()) ? i.item_brand : '',
                  comment: (i.item_comment && i.item_comment.trim()) ? i.item_comment : ''
                }
              })
              .filter(Boolean)

            // FIX: НЕ обновляем currentPallet.items если пользователь только что добавил товар локально.
            if (currentPallet.value && currentPallet.value.id === pallet.id) {
              const localItemCount = currentPallet.value.items?.length || 0
              const serverItemCount = serverItems.length

              // Если локальные items > 0 и >= серверных — пользователь добавил товар, НЕ перезаписываем!
              if (localItemCount > 0 && localItemCount >= serverItemCount) {
                console.log('⏭️ loadAllActivePallets: пропускаю обновление currentPallet (local', localItemCount, '>= server', serverItemCount, ')')
              } else if (currentPallet.value.id === pallet.id && localItemCount === 0) {
                // Загружаем с сервера только если локально пусто — это нормальная загрузка
                currentPallet.value.items = serverItems
                console.log('🔄 loadAllActivePallets: загружаю items для текущего паллета (local=0)')
              } else {
                console.log('⏭️ loadAllActivePallets: пропускаю (pallet id mismatch или local > server)')
              }
            }
          }
        } catch {}
        return { ...pallet, items: serverItems, createdAt: pallet.created_at }
      }))
      console.log('🏗️ loadAllActivePallets:', palletsWithItems.length, 'паллетов')
      return palletsWithItems
    } catch {
      return []
    }
  }

  /* ============================================================
  CRUD — прямые вызовы db
  ============================================================ */
  async function createPallet() {
    if (currentPallet.value) return currentPallet.value
    isSyncing.value = true
    syncError.value = null
    try {
      const userId = auth.getUserId()
      const result = await db.pallets.create(userId)
      if (result.error) throw new Error(result.error.message || 'Не удалось создать паллет')
      const serverPallet = result.data
      currentPallet.value = {
        id: serverPallet.id,
        number: serverPallet.pallet_number || 0,
        name: `Паллет ${serverPallet.pallet_number}`,
        createdAt: new Date().toISOString(),
        backendId: serverPallet.id,
        status: 'active',
        items: []
      }
      return currentPallet.value
    } catch (error) {
      syncError.value = `Не удалось создать паллет: ${error.message}`
      window.showToast(`⚠️ Не удалось создать паллет: ${error.message}`)
      return null
    } finally {
      isSyncing.value = false
    }
  }

  async function addBoxToPallet(box) {
    if (!currentPallet.value || !box.id) return false
    const exists = currentPallet.value.items.some(i => i.source_type === 'box' && i.source_id === box.id)
    if (exists) return false
    let palletId = null
    if (!currentPallet.value.backendId) {
      const createResult = await createPallet()
      if (!createResult || !createResult.backendId) return false
      palletId = createResult.backendId
    } else {
      palletId = currentPallet.value.backendId
    }
    if (navigator.onLine && palletId) {
      try {
        const result = await db.palletItems.create(palletId, 'box', box.id)
        if (!result?.data?.id) throw new Error('Не удалось добавить в паллет')
        // Обновляем статус короба на active чтобы не дублировался в списке
        await db.boxes.update(box.id, { status: 'active' })
      } catch (err) {
        if (err?.code === '23505' || /duplicate/i.test(err.message)) {
          return { success: false, error: 'duplicate', message: 'Этот микс уже в паллете' }
        }
        window.showToast(`⚠️ Не удалось сохранить товар в паллет: ${err.message}`)
        return false
      }
    }
    const undoId = crypto.randomUUID ? crypto.randomUUID() : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const boxWithItems = {
      source_type: 'box',
      source_id: box.id,
      order_num: box.number,
      _full_data: box.items && box.items.length > 0 ? { items: safeDeepClone(box.items) } : null,
      _undoId: undoId,
      _boxNumber: box.number,
      _boxName: box.name,
      _boxItemCount: (box.items && box.items.length) || 0
    }
    currentPallet.value.items.push(boxWithItems)
    actionHistory.value.push({ type: 'add_item', item: boxWithItems, timestamp: Date.now() })
    if (actionHistory.value.length > 50) actionHistory.value.shift()
    triggerPalletItemsUpdate()
    return true
  }

  async function addSeparateItemToPallet(item) {
    if (!currentPallet.value || !item.id) return false
    const exists = currentPallet.value.items.some(i => i.source_type === 'separate_item' && i.source_id === item.id)
    if (exists) return false
    let palletId = null
    if (!currentPallet.value.backendId) {
      const createResult = await createPallet()
      if (!createResult || !createResult.backendId) return false
      palletId = createResult.backendId
    } else {
      palletId = currentPallet.value.backendId
    }
    if (navigator.onLine && palletId) {
      try {
        const result = await db.palletItems.create(palletId, 'separate_item', item.id)
        if (!result?.data?.id) throw new Error('Не удалось добавить в паллет')
      } catch (err) {
        window.showToast(`⚠️ Не удалось сохранить товар в паллет: ${err.message}`)
        return false
      }
    }
    const undoId = crypto.randomUUID ? crypto.randomUUID() : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    currentPallet.value.items.push({ source_type: 'separate_item', source_id: item.id, comment: item.comment || '', scannedAt: item.scannedAt || null, _undoId: undoId })
    actionHistory.value.push({ type: 'add_item', item: { source_type: 'separate_item', source_id: item.id, comment: item.comment || '', scannedAt: item.scannedAt || null }, timestamp: Date.now() })
    if (actionHistory.value.length > 50) actionHistory.value.shift()
    triggerPalletItemsUpdate()
    return true
  }

  /** Проверка глобального дубликата (в других паллетах) — аналогично boxes.js checkGlobalDuplicate */
  function checkGlobalDuplicate(scannedBarcode) {
    const parsedNumber = parseBarcodeToBrainNumber(scannedBarcode)
    // Нормализуем: проверяем оба варианта, но в одном проходе
    const searchNumbers = new Set([scannedBarcode])
    if (parsedNumber && parsedNumber !== scannedBarcode) searchNumbers.add(parsedNumber)

    // Проверяем все активные паллеты из pallets store
    for (const pallet of pallets.value) {
      if (!pallet.items || pallet.status !== 'active') continue
      for (const item of pallet.items) {
        const itemParsed = parseBarcodeToBrainNumber(item.barcode)
        // Нормализуем и сравниваем в одном проходе
        const normalizedItemNumbers = new Set([item.barcode, itemParsed].filter(Boolean))
        for (const searchNum of searchNumbers) {
          if (normalizedItemNumbers.has(searchNum)) {
            return { boxNumber: pallet.number || pallet.pallet_number, boxName: pallet.name }
          }
        }
      }
    }

    // Проверяем текущий паллет
    if (currentPallet.value) {
      for (const item of currentPallet.value.items) {
        const itemParsed = parseBarcodeToBrainNumber(item.barcode)
        const normalizedItemNumbers = new Set([item.barcode, itemParsed].filter(Boolean))
        for (const searchNum of searchNumbers) {
          if (normalizedItemNumbers.has(searchNum)) {
            return { boxNumber: currentPallet.value.number || '', boxName: 'текущий' }
          }
        }
      }
    }

    return null
  }

  async function addInlineItemToPallet(itemData) {
    if (!currentPallet.value || !itemData.number) return false

    // BUG fix: дубликат check по barcode И source_id — серверные items могут иметь пустой barcode но валидный source_id
    const parsedNumber = parseBarcodeToBrainNumber(itemData.number)
    const exists = currentPallet.value.items.some(i => {
      if (i.barcode === itemData.number) return true
      // Fallback: сравниваем source_id для inline items
      if (i.source_id && String(i.source_id) === itemData.number) return true
      // Fallback: сравниваем parsed number
      if (parsedNumber && i.source_id && String(i.source_id) === parsedNumber) return true
      return false
    })
    if (exists) return false
    let palletId = null
    // BUG fix: при refresh currentPallet теряется, создаётся новый паллет вместо восстановления существующего
    if (!currentPallet.value.backendId && navigator.onLine) {
      const result = await db.pallets.getAll()
      if (result?.data) {
        const { useCollectorStore } = await import('@/stores/collector')
        const collectorStore = useCollectorStore()
        const myActivePallets = (result.data || [])
          .filter(p => p.status === 'active' && p.collector_id === collectorStore.employeeId)
        // P1 fix: сортируем по createdAt — берём самый свежий активный паллет
        myActivePallets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        if (myActivePallets.length > 0) {
          // Убрали localStorage fallback — берём первый активный паллет пользователя
          currentPallet.value = await loadActivePalletById(myActivePallets[0], result.data)
          if (currentPallet.value?.backendId) {
            palletId = currentPallet.value.backendId
          }
        }
      }
    }
    // Если всё ещё нет backendId — создаём новый паллет
    if (!palletId && !currentPallet.value?.backendId) {
      const createResult = await createPallet()
      if (!createResult || !createResult.backendId) return false
      palletId = createResult.backendId
    } else {
      palletId = currentPallet.value.backendId
    }
    let serverResult = null
    if (navigator.onLine && palletId && itemData.name) {
      try {
        // Передаём все поля напрямую для unified схемы
        serverResult = await db.palletItems.addInline(palletId, {
          ...itemData,
          source_type: 'inline'  // унифицированный тип вместо 'pallet'
        })
        if (serverResult?.error) {
          // Обработка дубликата — аналогично box_items duplicate handling
          if (serverResult.error.code === 409 || /duplicate/i.test(serverResult.error.message || '')) {
            const palletInfo = serverResult.detail?.pallet_info || serverResult.pallet_info
            let msg = `⚠️ Товар уже в паллете: ${itemData.number}`
            if (palletInfo?.pallet_number) {
              msg += ` (Паллет №${palletInfo.pallet_number})`
            }
            window.showToast(msg, 5000, 'error')
            // Возвращаем объект с деталями вместо false — чтобы caller показал правильный toast
            return { success: false, error: 'duplicate', pallet_info: palletInfo }
          } else {
            window.showToast(`⚠️ Не удалось сохранить товар на сервере: ${serverResult.error.message}`)
          }
        }
      } catch (err) {
        window.showToast(`⚠️ Не удалось сохранить товар на сервере: ${err.message}`)
        serverResult = { error: true }
      }
    }
    const undoId = crypto.randomUUID ? crypto.randomUUID() : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const itemRef = {
      source_type: 'inline',  // унифицированный тип вместо 'pallet'
      source_id: itemData.number,
      barcode: itemData.number,
      name: itemData.name || '',
      article: itemData.article || '',
      comment: itemData.comment || '',
      scannedAt: new Date().toISOString()
    }
    const serverOk = !navigator.onLine || !serverResult?.error
    if (serverOk) {
      // FIX: Vue не видит изменения массива через push() внутри объекта Pinia.
      // Нужно обновить весь currentPallet.value чтобы computed property пересчитался.
      const newItem = { ...itemRef, _undoId: undoId }
      actionHistory.value.push({ type: 'add_item', item: newItem, timestamp: Date.now() })
      if (actionHistory.value.length > 50) actionHistory.value.shift()

      // FIX: ОБЪЕДИНЯЕМ обновление items и timestamp в один шаг — Vue видит оба изменения одновременно
      const newItems = [...currentPallet.value.items, newItem]

      // CRITICAL FIX: создаём НОВЫЙ объект паллета с полной заменой (не spread)
      currentPallet.value = {
        id: currentPallet.value.id,
        number: currentPallet.value.number,
        name: currentPallet.value.name,
        createdAt: currentPallet.value.createdAt,
        backendId: currentPallet.value.backendId,
        status: 'active',
        items: newItems,
        _updatedAt: Date.now()
      }

      // CRITICAL FIX: форсируем обновление computed properties в UI
      triggerPalletItemsUpdate()
    } else {
      return false
    }
    return { success: true }
  }

  /** Удалить конкретный товар из паллета с синхронизацией на сервере */
  async function removeItemFromPallet(index) {
    if (!currentPallet.value || !currentPallet.value.items) return false

    const itemToRemove = currentPallet.value.items[index]
    if (!itemToRemove) return false

    // Локально удаляем сразу (optimistic update)
    currentPallet.value.items.splice(index, 1)

    // Синхронизация удаления на бэкенде
    if (navigator.onLine && currentPallet.value.backendId && itemToRemove.source_type && itemToRemove.source_id) {
      try {
        const st = itemToRemove.originalSourceType || itemToRemove.source_type
        const result = await db.palletItems.delete(currentPallet.value.backendId, st, itemToRemove.source_id)
        // FIX: корректная проверка — error есть ИЛИ success === false → rollback
        if (result?.error || result?.success === false) {
          window.showToast(`⚠️ Не удалось удалить товар с сервера: ${result.error || 'неизвестная ошибка'}`)
          // Rollback при ошибке
          currentPallet.value.items.splice(index, 0, itemToRemove)
          return false
        }
      } catch (err) {
        window.showToast(`⚠️ Не удалось удалить товар с сервера: ${err.message}`)
        // Rollback при ошибке
        currentPallet.value.items.splice(index, 0, itemToRemove)
        return false
      }
    }

    return true
  }

  async function finishCurrentPallet() {
    if (!currentPallet.value || currentPallet.value.items.length === 0) return null
    isSyncing.value = true
    syncError.value = null
    const originalPallet = JSON.parse(JSON.stringify(currentPallet.value))
    let finishSuccess = false
    let backendResult = null
    try {
      // Uбираем pre-check дедупликации — доверяем UNIQUE INDEX БД для защиты от race condition.
      // Обработка 23505 (UNIQUE violation) в catch блоке ниже гарантирует корректность.
      const itemsToSend = currentPallet.value.items.map(i => ({
        source_type: i.source_type,
        source_id: i.source_id,
        name: (i.name && i.name.trim()) ? i.name : `Товар ${i.source_id || ''}`,  // Fallback если имя пустое
        article: i.article || '',
        comment: i.comment || '',
        scanned_at: i.scannedAt || null
      }))

      // Логирование комментариев товаров при завершении паллета
      console.log('📦 Завершение паллета — комментарии товаров:')
      itemsToSend.forEach(item => {
        const label = `${item.source_type}:${item.source_id}`
        console.log(`  ${label} → comment: "${item.comment}"`)
      })

      if (navigator.onLine && currentPallet.value.backendId) {
        let result = null
        try {
          result = await db.pallets.update(currentPallet.value.backendId, {
            status: 'finished',
            items: itemsToSend
          })
        } catch (updateErr) {
          // BUG-1 fix: ловим PostgreSQL UNIQUE violation (23505) — race condition между pre-check и INSERT.
          // Если товар уже есть на сервере — это не ошибка, считаем как success.
          if (updateErr?.code === '23505' || updateErr?.detail?.includes('duplicate')) {
            console.log('🔄 finishCurrentPallet: UNIQUE conflict, игнорируем (товар уже на сервере)')
            result = { data: null, error: null } // success без ошибки
          } else {
            throw updateErr
          }
        }

        if (result?.error) {
          if (result.error.code === 403 && result.error.message?.includes('создан')) {
            // Паллет уже завершён на сервере (возможно, другим устройством).
            // Запрашиваем актуальные данные и показываем их как finished.
            window.showToast(result.error.message, 4000, 'error')
            try {
              const freshResult = await db.pallets.getById(currentPallet.value.id)
              if (freshResult?.data && freshResult.data.status === 'finished') {
                backendResult = freshResult.data
                finishSuccess = true
                result.error = null // отменяем ошибку — считаем успехом
              } else {
                throw new Error(result.error.message)
              }
            } catch (fetchErr) {
              syncError.value = `Паллет завершён на сервере, но не удалось загрузить данные: ${fetchErr.message}`
              window.showToast(`⚠️ Паллет уже завершён`, 3000, 'warning')
            } finally {
              isSyncing.value = false
            }
          } else if (result.error.code === 403) {
            syncError.value = `Ошибка прав доступа: ${result.error.message}`
            window.showToast(`⚠️ Ошибка прав доступа`, 3000, 'warning')
          } else {
            throw new Error(result.error.message)
          }
        } else if (result?.success === false || result?.error) {
          // Обработка ответа с success: false — аналогично обработке 409 duplicate
          const errorMsg = result.detail || result.message || 'Неизвестная ошибка'
          console.warn('finishCurrentPallet: server returned error', result)
        }

        backendResult = result.data
        finishSuccess = true
      } else if (!navigator.onLine && currentPallet.value.backendId) {
        finishSuccess = true
      }
    } catch (error) {
      syncError.value = `Не удалось завершить паллет: ${error.message}`
      if (!error.message?.includes('создан')) {
        window.showToast(`⚠️ Не удалось завершить паллет: ${error.message}`)
      }
    } finally {
      isSyncing.value = false
    }
    if (finishSuccess && currentPallet.value) {
      const finishedPallet = {
        ...originalPallet,
        backendId: currentPallet.value.backendId,
        status: 'finished',
        createdAt: backendResult?.created_at || backendResult?.createdAt || originalPallet.createdAt,
        finishedAt: backendResult?.finished_at || backendResult?.finishedAt || originalPallet.finishedAt,
        seal: backendResult?.seal || null,
        palletId: backendResult?.palletId || currentPallet.value.id,
        items: backendResult?.items || originalPallet.items  // ALWAYS use server data when available
      }

      pallets.value.push(finishedPallet)

      currentPallet.value = null
      return finishedPallet
    }
    return null
  }

  /** Отмена последнего действия с удалением товара с сервера */
  async function undoLastAction() {
    if (!currentPallet.value || !actionHistory.value.length) return null
    const lastAction = actionHistory.value.pop()

    if (lastAction.type === 'add_item') {
      if (!lastAction.item) return null
      
      // BUG-228 fix: ищем по source_type+source_id вместо _undoId (надёжнее при WS обновлениях)
      const idx = currentPallet.value.items.findIndex(i =>
        i.source_type === lastAction.item.source_type &&
        i.source_id === lastAction.item.source_id
      )
      if (idx !== -1) {
        const itemToRemove = currentPallet.value.items[idx]
        currentPallet.value.items.splice(idx, 1)

        // Синхронизация удаления на бэкенде при undo
        if (navigator.onLine && currentPallet.value.backendId && itemToRemove.source_type && itemToRemove.source_id) {
          try {
            const result = await db.palletItems.delete(currentPallet.value.backendId, itemToRemove.source_type, itemToRemove.source_id)
            if (result?.error) {
              // Ошибка удаления — возвращаем товар обратно
              currentPallet.value.items.splice(idx, 0, itemToRemove)
              actionHistory.value.push(lastAction)
              window.showToast(`⚠️ Не удалось отменить: ${result.error || 'ошибка сервера'}`)
            } else {
              console.log('↩️ undoLastAction: удалено с сервера')
            }
          } catch (err) {
            // Ошибка сети — возвращаем товар обратно
            currentPallet.value.items.splice(idx, 0, itemToRemove)
            actionHistory.value.push(lastAction)
            window.showToast(`⚠️ Не удалось отменить: ${err.message}`)
          }
        }

        return lastAction.item || null
      }
    }

    return null
  }

  async function clearAllPallets() {
    if (!checkIsAdmin()) {
      window.showToast('⚠️ Очищать общую базу может только администратор')
      return { success: false, error: 'Только админ' }
    }
    isSyncing.value = true
    try {
      const result = await db.pallets.clearAll()
      if (result.error) {
        window.showToast(`❌ Ошибка: ${result.error.message}`)
        return { success: false, error: result.error.message }
      }
      pallets.value = []
      availableBoxes.value = []
      availableSeparateItems.value = []
      currentPallet.value = null
      return { success: true }
    } catch (error) {
      window.showToast(`❌ Ошибка: ${error.message}`)
      return { success: false, error: error.message }
    } finally {
      isSyncing.value = false
    }
  }

  function clearAllPalletsFromBackend() {
    pallets.value = []
    currentPallet.value = null
    availableBoxes.value = []
    availableSeparateItems.value = []
    window.showToast('🗑 Паллеты удалены на сервере, данные очищены')
  }

  function getAllPalletItems() {
    const result = []
    for (const pallet of pallets.value) {
      if (pallet.items) {
        for (const item of pallet.items) {
          const name = item.item_name || item.name || 'Товар'
          const article = item.item_brand || item.brand || ''
          result.push({
            palletName: pallet.name || 'Паллет',
            type: item.source_type || '',
            number: item.barcode || String(item.source_id),
            name: name,
            article: article,
            scannedAt: item.scanned_at || null
          })
        }
      }
    }
    return result
  }

  async function cancelCurrentPallet() {
    if (!currentPallet.value || !currentPallet.value.backendId) {
      currentPallet.value = null
      return
    }
    
    if (navigator.onLine) {
      const itemsToDelete = [...(currentPallet.value.items || [])]
      await Promise.all(
        itemsToDelete.map(item => {
          const st = item.originalSourceType || item.source_type
          return db.palletItems.delete(currentPallet.value.id, st, item.source_id).catch(err => {
            console.error('❌ Не удалось удалить товар из паллета:', err)
          })
        })
      )
    }
    
    currentPallet.value.items = []
  }

  return {
    pallets,
    currentPallet,
    availableBoxes,
    availableSeparateItems,
    isSyncing,
    syncError,
    totalPallets,
    currentPalletItemCount,
    hasAvailableBoxes,
    hasAvailableSeparateItems,
    canUndo,
    palletItemsVersion,
    triggerPalletItemsUpdate,
    createPallet,
    loadActivePallet,
    loadActivePalletById,  // ← добавляем для использования извне (ScanView.vue)
    addBoxToPallet,
    addSeparateItemToPallet,
    addInlineItemToPallet,
    removeItemFromPallet,
    finishCurrentPallet,
    loadAllActivePallets,
    loadPallets,
    loadAvailableBoxes,
    refreshAvailableBoxItems,
    loadAvailableSeparateItems,
    clearAllPallets,
    clearAllPalletsFromBackend,
    undoLastAction,
    checkGlobalDuplicate,
    getAllPalletItems,
    cancelCurrentPallet
  }
})