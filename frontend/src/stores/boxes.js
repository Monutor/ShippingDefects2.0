import { defineStore } from 'pinia'
import { ref, computed, triggerRef } from 'vue'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { auth, db } from '@/lib/api.js'
import { isAdmin } from '@/config'
import { scanBatchManager, logScan } from '@/utils/sync'

/**
 * Store для управления коробами с товарами (server-first).
 * Данные хранятся на сервере. localStorage — только UI-состояние.
 */
export const useBoxesStore = defineStore('boxes', () => {
  // Массив собранных коробов
  const boxes = ref([])

  // Текущий активный короб (в процессе сборки)
  const currentBox = ref(null)

  /** Валидация currentBox — если не найден на сервере → очищает */
  async function validateCurrentBox() {
    if (!currentBox.value || !navigator.onLine) return true
    try {
      const result = await db.boxes.getAll()
      if (result?.data) {
        const exists = result.data.some(b => b.id === currentBox.value.id && b.collector_id === collectorStore.employeeId)
        if (!exists) {
          console.log('🗑️ Stale currentBox валидация не прошла, очищен')
          currentBox.value = null
          return false
        }
      }
    } catch {}
    return true
  }

  // История действий для undo (максимум 50 действий)
  const actionHistory = ref([])
  const MAX_HISTORY = 50

  // Статус синхронизации
  const isSyncing = ref(false)
  const syncError = ref(null)

  /** Очередь офлайн добавлений в короб — BUG-4 fix: товары добавляются локально но не синхронизируются без очереди */
  const pendingOfflineBoxItems = ref([])

  /** Flush offline box items queue — BUG-4 fix: отправляем накопленные офлайн товары при восстановлении сети */
  async function flushPendingOfflineBoxItems() {
    if (!navigator.onLine || pendingOfflineBoxItems.value.length === 0) return

    // TTL: очищаем офлайн записи старше 24 часов чтобы не накапливались бесконечно
    const MAX_OFFLINE_AGE_MS = 24 * 60 * 60 * 1000 // 24 часа
    const now = Date.now()
    pendingOfflineBoxItems.value = pendingOfflineBoxItems.value.filter(entry => {
      if (entry.timestamp && (now - entry.timestamp) > MAX_OFFLINE_AGE_MS) {
        console.warn(`🗑️ TTL: офлайн запись удалена (${Math.round((now - entry.timestamp) / 3600000)}ч назад)`)
        return false
      }
      return true
    })

    if (pendingOfflineBoxItems.value.length === 0) return

    const queued = [...pendingOfflineBoxItems.value]
    pendingOfflineBoxItems.value = []

    for (const entry of queued) {
      try {
        // Нужно: добавить товар в короб на сервере. Используем существующий API через db.boxItems.add
        await db.boxItems.addItem(entry.boxId, {
          barcode: entry.item.number,
          name: entry.item.name,
          brand: entry.item.article || '',
          comment: entry.item.comment || ''
        })
      } catch (err) {
        // P1 fix: при дубликате НЕ возвращаем в очередь — товар реально уже в коробе. Без этого бесконечный цикл retry.
        if (err?.code === '23505' || /duplicate/i.test(err?.message)) {
          console.log('🔄 flushPendingOfflineBoxItems: товар уже в коробе на сервере, пропускаем')
          // НЕ возвращаем в очередь — товар реально дубликат
        } else if (pendingOfflineBoxItems.value.length > 0) {
          pendingOfflineBoxItems.value.unshift(entry) // возвращаем в начало очереди
          console.warn(`⚠️ Не удалось синхронизировать товар ${entry.item.number} в короб ${entry.boxId}:`, err.message)
        }
      }
    }
  }

  // Вычисляемое: количество собранных коробов
  const totalBoxes = computed(() => boxes.value.length)

  // Вычисляемое: количество товаров в текущем коробе
  const currentBoxItemsCount = computed(() => {
    return currentBox.value && currentBox.value.items ? currentBox.value.items.length : 0
  })

  // Вычисляемое: есть ли действия для отмены
  const canUndo = computed(() => actionHistory.value.length > 0)

  // Вычисляемое: последний отсканированный товар (для UI)
  const lastScannedItem = computed(() => {
    if (actionHistory.value.length === 0) return null
    const lastAction = actionHistory.value[actionHistory.value.length - 1]
    return lastAction.type === 'add_item' ? lastAction.item : null
  })

  // Вычисляемое: товары текущего короба в обратном порядке (новые сверху)
  const currentBoxItemsReverse = computed(() => {
    if (!currentBox.value || !currentBox.value.items.length) return []
    return [...currentBox.value.items].reverse()
  })

  // Вычисляемое: собранные короба в обратном порядке (новые сверху)
  const boxesReverse = computed(() => [...boxes.value].reverse())

  /* ============================================================
   Загрузка данных с сервера
   ============================================================ */

  /** Загрузка активного короба с бэкенда */
  async function loadActiveBox() {
    try {
      if (!navigator.onLine) return null

      const result = await db.boxes.getAll()
      if (result.error) return null

      const activeBoxes = (result.data || []).filter(b => b.status === 'active')
      if (activeBoxes.length === 0) {
        // Нет активного короба на сервере — currentBox остаётся null, UI покажет кнопки создания
        return null
      }

      // ВАЖНО: выбираем СВОЙ короб (по collector_id), а не первый попавшийся
      const { useCollectorStore } = await import('@/stores/collector')
      const collectorStore = useCollectorStore()
      // BUG-229 fix: проверяем что collectorStore инициализирован
      if (!collectorStore.employeeId) {
        console.log('⚠️ loadActiveBox: collectorStore не инициализирован')
        return null
      }
      const myBox = activeBoxes.find(b => b.collector_id === collectorStore.employeeId) || null

      if (!myBox) {
        console.log('⚠️ loadActiveBox: нет своих активных коробов для employeeId', collectorStore.employeeId)
        return null
      }

      const box = myBox

      // Загружаем товары
      const itemsResult = await db.boxItems.getByBoxId(box.id)
      const items = (itemsResult.data || []).map(item => ({
        number: item.barcode,
        name: item.name,
        article: item.brand || '',
        comment: item.comment || '',
        scannedAt: item.created_at
      }))

      // ВАЖНО: backendId нужно установить, иначе addItemToCurrentBox пропустит PUT-запрос
      currentBox.value = { ...box, items, backendId: box.id, createdAt: box.created_at || new Date().toISOString() }
      return currentBox.value
    } catch {
      return null
    }
  }

  /** Загрузка всех активных коробов с сервера */
  async function loadAllActiveBoxes() {
    try {
      if (!navigator.onLine) return []

      const result = await db.boxes.getAll()

      // Если ошибка или нет данных → currentBox НЕ может быть валидным → очищаем
      if (result.error || !result?.data || !Array.isArray(result.data)) {
        console.log('🗑️ Ошибка/нет данных с сервера, currentBox ВСЕГДА очищен')
        currentBox.value = null
        return []
      }

      const activeBoxes = result.data.filter(b => b.status === 'active' && b.collector_id === collectorStore.employeeId)

      // Если нет активных коробов на сервере → проверяем currentBox перед очисткой
      if (activeBoxes.length === 0) {
        // BUG-235 fix: не очищаем currentBox если он создан локально и ещё не синхронизирован
        if (currentBox.value && currentBox.value.backendId) {
          console.log('⚠️ currentBox существует локально, не очищаем')
          return [currentBox.value]
        }
        console.log('🗑️ Нет активных коробов на сервере, currentBox очищен')
        currentBox.value = null
        return []
      }

      // Очищаем stale currentBox если он не найден среди активных
      if (currentBox.value && !activeBoxes.some(b => b.id === currentBox.value.id)) {
        console.log('🗑️ Stale currentBox удалён из Pinia')
        currentBox.value = null
      }

      // Загружаем товары для каждого активного короба
      const boxesWithItems = await Promise.all(activeBoxes.map(async (box) => {
        const itemsResult = await db.boxItems.getByBoxId(box.id)
        const items = (itemsResult.data || []).map(item => ({
          number: item.barcode,
          name: item.name,
          article: item.brand || '',
          comment: item.comment || '',
          scannedAt: item.created_at
        }))
        return { ...box, items, createdAt: box.created_at }
      }))

      console.log('📦 loadAllActiveBoxes:', boxesWithItems.length, 'коробов')
      return boxesWithItems
    } catch {
      return []
    }
  }

  /** Загрузка собранных (finished) коробов с бэкенда */
  async function loadBoxes() {
    try {
      if (!navigator.onLine) return []

      const result = await db.boxes.getAll()
      if (result.error) return []

      const finishedBoxesRaw = (result.data || []).filter(b => b.status === 'finished')

      // Сохраняем Map загруженных items ПЕРЕЗ заменой массива — H3 fix: lazy-loaded items не теряются при reload
      const prevItemsMap = new Map()
      boxes.value.forEach(box => {
        if (box.id && box.itemsLoaded && box.items?.length > 0) {
          prevItemsMap.set(box.id, [...box.items])
        }
      })

      // Lazy load: не грузим items для всех finished коробов — только базовые данные
      const boxesWithItems = finishedBoxesRaw.map(box => {
        if (!box.id) return null
        // Восстанавливаем lazy-loaded items из предыдущего состояния если они есть
        const prevItems = prevItemsMap.get(box.id) || []
        return {
          id: box.id,
          number: box.box_number || box.number || 0,
          name: box.name,
          collector_id: box.collector_id,
          collector_full_name: box.collector_full_name || null,
          createdAt: box.created_at,
          status: box.status,
          items: prevItems.length > 0 ? prevItems : [],  // restore если были загружены ранее
          itemsLoaded: prevItemsMap.has(box.id)  // помечаем что items уже загружены
        }
      }).filter(Boolean)

      boxes.value = boxesWithItems
      return boxesWithItems
    } catch {
      return []
    }
  }

  /** Обновить items конкретного finished короба (lazy load) */
  async function refreshBoxItems(boxId) {
    try {
      if (!navigator.onLine) return []

      const result = await db.boxItems.getByBoxId(boxId)
      const items = (result.data || []).map(item => ({
        number: item.barcode,
        name: item.name,
        article: item.brand || '',
        comment: item.comment || '',
        scannedAt: item.created_at
      }))

      // Находим короб в массиве и обновляем items + флаг loaded
      const box = boxes.value.find(b => b.id === boxId)
      if (box) {
        // BUG-224 fix: заменяем весь объект чтобы Vue отследил мутации
        boxes.value[boxes.value.indexOf(box)] = { ...box, items, itemsLoaded: true }
      }
      return items
    } catch {
      return []
    }
  }

  /* ============================================================
   CRUD операции — все идут напрямую на сервер
   ============================================================ */

  /** Создание нового короба */
  async function createBox() {
    // BUG-234 fix: проверяем что currentBox ещё не существует
    if (currentBox.value) {
      return currentBox.value
    }
    if (!navigator.onLine) {
      window.showToast('⚠️ Нет сети, создайте короб при подключении')
      return null
    }

    const userId = auth.getUserId()
    if (!userId) {
      window.showToast('⚠️ Не авторизован')
      return null
    }

    isSyncing.value = true
    syncError.value = null
    
    try {
      // Создаём на сервере → получаем backendId
      const result = await db.boxes.create(userId)
      if (result.error) throw new Error(result.error.message || 'Не удалось создать короб')

      const serverBox = result.data
      
      currentBox.value = {
        id: serverBox.id,
        number: serverBox.box_number || 0,
        name: serverBox.name || `Микс ${serverBox.box_number}`,
        createdAt: new Date().toISOString(),
        backendId: serverBox.id,
        status: 'active',
        items: []
      }

      return currentBox.value
    } catch (error) {
      syncError.value = `Не удалось создать короб: ${error.message}`
      return null
    } finally {
      isSyncing.value = false
    }
  }

  /** Добавление товара в текущий короб */
  async function addItemToCurrentBox(item) {
    console.log('🔍 addItemToCurrentBox called:', item, 'currentBox:', currentBox.value?.id)
    if (!currentBox.value) {
      console.error('❌ addItemToCurrentBox: no currentBox!')
      return { success: false, error: 'Нет активного короба' }
    }

    // M1 fix: используем parseBarcode для consistency с checkGlobalDuplicate
    const parsedItemNumber = parseBarcodeToBrainNumber(item.number)
    console.log('🔍 addItemToCurrentBox: item.number=', item.number, 'parsed=', parsedItemNumber)
    
    // Глобальная проверка дубликатов
    const globalDup = checkGlobalDuplicate(item.number)
    if (globalDup) {
      return { success: false, error: 'duplicate_global', boxNumber: globalDup.boxNumber, boxName: globalDup.boxName }
    }
    
    const duplicateInCurrent = currentBox.value.items.find(
      i => {
        const parsedI = parseBarcodeToBrainNumber(i.number)
        return (parsedI && parsedI === parsedItemNumber) || i.number === item.number
      }
    )
    if (duplicateInCurrent) {
      return { success: false, error: 'duplicate_current' }
    }

    // Сохраняем состояние для undo
    const itemCopy = JSON.parse(JSON.stringify({
      ...item,
      scannedAt: new Date().toISOString()
    }))

    // Добавляем товар локально (optimistic update)
    actionHistory.value.push({
      type: 'add_item',
      item: itemCopy,
      boxId: currentBox.value.id,
      timestamp: Date.now()
    })

    if (actionHistory.value.length > MAX_HISTORY) {
      actionHistory.value.shift()
    }

    // FIX: Vue не видит изменения массива через push() внутри объекта Pinia.
    // Нужно обновить весь currentBox.value чтобы computed property пересчитался.
    const newItem = { ...itemCopy, scannedAt: new Date().toISOString() }
    const newItems = [...currentBox.value.items, newItem]
    currentBox.value = { ...currentBox.value, items: newItems }

    // Логирование сканирования (пакетная отправка)
    logScan({
      barcode: item.number,
      itemNumber: item.number,
      itemName: item.name,
      action: 'added',
      boxId: currentBox.value.id.toString()
    })

    // Синхронизация на бэкенде (прямой PUT) или очередь если офлайн — BUG-4 fix
    if (navigator.onLine && currentBox.value.backendId) {
      try {
        const result = await db.boxes.update(currentBox.value.backendId, {
          item: { barcode: item.number, name: item.name, brand: item.article, comment: item.comment || '' }
        })

        if (result.error) {
          // Проверяем на дубликат — FIX: используем pop() вместо splice(pushIndex, 1)
          // чтобы не удалить чужой элемент при WebSocket обновлениях от других клиентов
          if (/duplicate/i.test(result.error.message || '') || result.error.code === 409) {
            currentBox.value.items.pop()
            actionHistory.value.pop()

            // F2 fix: показываем конкретный номер короба где уже лежит товар (из 409 response)
            const boxNumber = result.error.detail?.box_number || result.error.box_number || 'неизвестен'
            window.showToast(`⚠️ Товар уже в коробе №${boxNumber}`, 5000, 'error')

            return { success: false, error: 'duplicate_server', boxNumber }
          }
          // FIX: pop() вместо splice(pushIndex, 1) — безопасно при WS обновлениях от других клиентов
          currentBox.value.items.pop()
          actionHistory.value.pop()
          syncError.value = `Не синхронизировано: ${result.error.message}`
          window.showToast(`⚠️ Не удалось сохранить товар: ${result.error.message}`)
          return { success: false }
        }
      } catch (error) {
        // FIX: pop() вместо splice(pushIndex, 1) — безопасно при WS обновлениях
        currentBox.value.items.pop()
        actionHistory.value.pop()
        syncError.value = `Не синхронизировано: ${error.message}`
        window.showToast(`⚠️ Не удалось сохранить товар: ${error.message}`)
      }
    } else if (currentBox.value.backendId && !navigator.onLine) {
      // BUG-4 fix: офлайн — добавляем в очередь, flush при восстановлении сети
      pendingOfflineBoxItems.value.push({
        boxId: currentBox.value.backendId,
        item: { ...itemCopy },
        timestamp: Date.now()  // Для TTL очистки
      })
    } else if (navigator.onLine && !currentBox.value.backendId) {
      // BUG-106 fix: online но нет backendId — тоже в очередь
      pendingOfflineBoxItems.value.push({
        boxId: null,
        item: { ...itemCopy },
        timestamp: Date.now()
      })
    }

    return { success: true }
  }

  /** Проверка глобального дубликата (в других коробах) — H3: один pass с нормализацией */
  function checkGlobalDuplicate(scannedBarcode) {
    const parsedNumber = parseBarcodeToBrainNumber(scannedBarcode)
    // Нормализуем: проверяем оба варианта, но в одном проходе
    const searchNumbers = new Set([scannedBarcode])
    if (parsedNumber && parsedNumber !== scannedBarcode) searchNumbers.add(parsedNumber)

    for (const box of boxes.value) {
      for (const item of box.items) {
        const itemParsed = parseBarcodeToBrainNumber(item.number)
        // Нормализуем и сравниваем в одном проходе — H3 fix вместо double-check parsed/original
        const normalizedItemNumbers = new Set([item.number, itemParsed].filter(Boolean))
        for (const searchNum of searchNumbers) {
          if (normalizedItemNumbers.has(searchNum)) {
            return { boxNumber: box.number, boxName: box.name }
          }
        }
      }
    }

    // Проверяем текущий короб
    if (currentBox.value) {
      for (const item of currentBox.value.items) {
        const itemParsed = parseBarcodeToBrainNumber(item.number)
        const normalizedItemNumbers = new Set([item.number, itemParsed].filter(Boolean))
        for (const searchNum of searchNumbers) {
          if (normalizedItemNumbers.has(searchNum)) {
            return { boxNumber: currentBox.value.number, boxName: 'текущий' }
          }
        }
      }
    }

    return null
  }

  /** Завершение текущего короба */
  async function finishCurrentBox() {
    if (!currentBox.value || currentBox.value.items.length === 0) return null

    isSyncing.value = true
    syncError.value = null
    
    const originalCurrentBox = JSON.parse(JSON.stringify(currentBox.value))

    try {
      // Сначала завершаем короб на сервере (PUT status=finished) — C3: используем backendId вместо id
      if (navigator.onLine && currentBox.value.backendId) {
        const updateResult = await db.boxes.update(currentBox.value.backendId, { status: 'finished' })

        if (updateResult.error) throw new Error(updateResult.error.message)

        // Получаем items от сервера для экспорта — C4: сохраняем оригинал перед merge
        const originalItemsSnapshot = JSON.parse(JSON.stringify(originalCurrentBox.items))
        
        const itemsResult = await db.boxItems.getByBoxId(currentBox.value.backendId)

        const serverItems = (itemsResult.data || []).map(item => ({
          number: item.barcode,
          name: item.name,
          article: item.brand || '',
          comment: item.comment || '',
          scannedAt: item.created_at || ''  // C4: fallback на пустую строку если нет created_at
        }))

        // C4: merge — по barcode, а не по индексу (BUG-212 fix)
        const mergedItems = serverItems.length > 0 ? (() => {
          if (!originalCurrentBox.items.length) return serverItems
          const byBarcode = new Map(serverItems.map(si => [si.number, si]))
          return originalItemsSnapshot.map(origItem => {
            const serverItem = byBarcode.get(origItem.number)
            return serverItem
              ? { ...serverItem, scannedAt: serverItem.scannedAt || origItem.scannedAt || '' }
              : origItem
          })
        })() : originalItemsSnapshot

        // Добавляем в локальный массив (Pinia persist убран — данные только с сервера)
        const finishedBoxWithBackend = { ...originalCurrentBox, backendId: currentBox.value.backendId, status: 'finished', items: mergedItems }
        boxes.value.push(finishedBoxWithBackend)

        // Очищаем currentBox и возвращаем УСПЕШНЫЙ короб (с правильными данными с сервера)
        currentBox.value = null
        return finishedBoxWithBackend
      } else if (navigator.onLine) {
        syncError.value = 'Короб не синхронизирован с сервером. Завершите при подключении.'
        boxes.value.push({ ...originalCurrentBox, status: 'finished', synced: false })
        currentBox.value = null
        return originalCurrentBox
      } else {
        boxes.value.push({ ...originalCurrentBox, status: 'finished', synced: false })
      }

      currentBox.value = null
      return originalCurrentBox
    } catch (error) {
      syncError.value = `Не удалось завершить короб: ${error.message}`

      // Обработка 403 — чужой контейнер
      if (error.message?.includes('создан')) {
        window.showToast(error.message, 4000, 'error')
      } else {
        currentBox.value = originalCurrentBox
      }
      return null
    } finally {
      isSyncing.value = false
    }
  }

  /** Отмена последнего действия */
  async function undoLastAction() {
    if (actionHistory.value.length === 0) return null

    const lastAction = actionHistory.value.pop()

    if (lastAction.type === 'add_item') {
      if (currentBox.value && currentBox.value.id === lastAction.boxId) {
        const itemIndex = currentBox.value.items.findIndex(
          item => item.number === lastAction.item.number
        )
        if (itemIndex !== -1) {
          const itemToRemove = currentBox.value.items[itemIndex]
          currentBox.value.items.splice(itemIndex, 1)

          // Синхронизация удаления на бэкенде
          if (navigator.onLine && currentBox.value.backendId) {
            try {
              await db.boxItems.deleteItem(currentBox.value.id, itemToRemove.number)
            } catch {
              currentBox.value.items.splice(itemIndex, 0, itemToRemove)
              actionHistory.value.push(lastAction)
            }
          }

          return lastAction.item
        }
      }
    }

    return null
  }

  /** Удалить конкретный товар из текущего короба */
  function removeItemFromCurrentBox(index) {
    if (!currentBox.value || !currentBox.value.items) return false
    const itemToRemove = currentBox.value.items[index]
    if (!itemToRemove) return false

    // Локально удаляем сразу
    currentBox.value.items.splice(index, 1)

    // Синхронизация удаления на бэкенде
    if (navigator.onLine && currentBox.value.backendId) {
      db.boxItems.deleteItem(currentBox.value.id, itemToRemove.number).catch(err => {
        console.error('❌ Не удалось удалить товар из короба:', err)
        // Rollback при ошибке
        currentBox.value.items.splice(index, 0, itemToRemove)
      })
    }

    return true
  }

  async function cancelCurrentBox() {
    if (!currentBox.value || !currentBox.value.backendId) {
      currentBox.value = null
      return
    }
    
    if (navigator.onLine) {
      const itemsToDelete = [...(currentBox.value.items || [])]
      await Promise.all(
        itemsToDelete.map(item => 
          db.boxItems.deleteItem(currentBox.value.id, item.number).catch(err => {
            console.error('❌ Не удалось удалить товар из короба:', err)
          })
        )
      )
    }
    
    currentBox.value.items = []
  }

  /** Получение всех товаров из всех коробов */
  function getAllBoxItems() {
    const allItems = []
    boxes.value.forEach(box => {
      box.items.forEach(item => {
        allItems.push({ ...item, boxName: box.name, boxNumber: box.number })
      })
    })
    if (currentBox.value) {
      currentBox.value.items.forEach(item => {
        allItems.push({ ...item, boxName: currentBox.value.name, boxNumber: currentBox.value.number })
      })
    }
    return allItems
  }

  /** Удалить один короб из списка */
  async function deleteBox(boxId) {
    const box = boxes.value.find(b => b.id === boxId)
    if (!box) return { success: false, error: 'Короб не найден' }

    // Проверяем статус — только finished
    if (box.status !== 'finished') {
      return { success: false, error: 'Можно удалить только завершённый короб' }
    }

    // Удаляем с бэкенда если онлайн
    let backendOk = true
    if (navigator.onLine) {
      const result = await db.boxes.delete(boxId)
      if (result.error) {
        backendOk = false
      }
    }

    const idx = boxes.value.findIndex(b => b.id === boxId)
    if (idx !== -1) boxes.value.splice(idx, 1)

    return { success: true, backendSynced: backendOk }
  }

  /** Очистка всех finished коробов */
  async function clearAllBoxes() {
    if (!isAdmin()) {
      window.showToast('⚠️ Очищать общую базу может только администратор')
      return { success: false, error: 'Только админ' }
    }

    isSyncing.value = true
    
    try {
      const result = await db.boxes.clearAllFinished()
      
      if (result.error) {
        window.showToast(`❌ Ошибка очистки серверной базы: ${result.error.message}`)
        return { success: false, error: result.error.message }
      }

      // Очищаем локально
      boxes.value = []
      currentBox.value = null  // M5 fix: не оставляем ghost-короб
      console.log('✅ Короба очищены, всего:', boxes.value.length)
      return { success: true }
    } catch (error) {
      window.showToast(`❌ Ошибка: ${error.message}`)
      return { success: false, error: error.message }
    } finally {
      isSyncing.value = false
    }
  }

  /** Очистка при получении события с сервера — только finished (не active!) */
  function clearAllBoxesFromBackend() {
    boxes.value = boxes.value.filter(b => b.status === 'active')
    window.showToast('🗑 Короба удалены на сервере, данные очищены')
  }

  return {
    boxes,
    currentBox,
    actionHistory,
    totalBoxes,
    currentBoxItemsCount,
    canUndo,
    lastScannedItem,
    currentBoxItemsReverse,
    boxesReverse,
    isSyncing,
    syncError,
    createBox,
    addItemToCurrentBox,
    checkGlobalDuplicate,
    finishCurrentBox,
    undoLastAction,
    removeItemFromCurrentBox,
    cancelCurrentBox,
    getAllBoxItems,
    deleteBox,
    clearAllBoxes,
    clearAllBoxesFromBackend,
    loadActiveBox,
    loadAllActiveBoxes,
    loadBoxes,
    refreshBoxItems,
    flushPendingOfflineBoxItems  // BUG-4 fix: export для main.js online handler
  }
}, { persist: false }) // отключён Pinia persist — сервер-фёрст архитектура
