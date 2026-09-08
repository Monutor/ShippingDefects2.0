import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { dbStore as db } from '@/lib/db.js'
import { logScan } from '@/utils/sync'
import { showError } from '@/utils/showError'
import { useCanUndo, useLastScannedItem, clearAllWithAdminCheck } from './useContainerUtils'

/**
 * Store для управления коробами с товарами (локальное хранение в IndexedDB).
 * Данные хранятся в IndexedDB. localStorage — только UI-состояние.
 */
export const useBoxesStore = defineStore(
  'boxes',
  () => {
    // Массив собранных коробов
    const boxes = ref([])

    // Текущий активный короб (в процессе сборки)
    const currentBox = ref(null)

    // История действий для undo (максимум 50 действий)
    const actionHistory = ref([])
    const MAX_HISTORY = 50

    // Статус синхронизации
    const isSyncing = ref(false)
    const syncError = ref(null)

    // Вычисляемое: количество собранных коробов
    const totalBoxes = computed(() => boxes.value.length)

    // Вычисляемое: количество товаров в текущем коробе
    const currentBoxItemsCount = computed(() => {
      return currentBox.value && currentBox.value.items ? currentBox.value.items.length : 0
    })

    // Вычисляемые из shared utils
    const canUndo = useCanUndo(actionHistory)
    const lastScannedItem = useLastScannedItem(actionHistory)

    // Вычисляемое: товары текущего короба в обратном порядке (новые сверху)
    const currentBoxItemsReverse = computed(() => {
      if (!currentBox.value || !currentBox.value.items || !currentBox.value.items.length) return []
      return [...currentBox.value.items].reverse()
    })

    // Вычисляемое: собранные короба в обратном порядке (новые сверху)
    const boxesReverse = computed(() => [...boxes.value].reverse())

    /* ============================================================
    Загрузка данных из IndexedDB
   ============================================================ */

    /** Загрузка активного короба из локального хранилища */
    async function loadActiveBox() {
      try {
        const result = await db.boxes.getAll()
        if (result.error) return null

        const activeBoxes = (result.data || []).filter((b) => b.status === 'active')
        if (activeBoxes.length === 0) {
          // Нет активного короба в локальном хранилище — currentBox остаётся null, UI покажет кнопки создания
          return null
        }

        // Single-user: сборщик один — берём первый активный короб
        const box = activeBoxes[0] || null

        if (!box) {
          return null
        }

        // Загружаем товары
        const itemsResult = await db.boxItems.getByBoxId(box.id)
        const items = (itemsResult.data || []).map((item) => ({
          number: item.barcode,
          name: item.name,
          article: item.brand || '',
          comment: item.comment || '',
          scannedAt: item.created_at
        }))

        // ВАЖНО: backendId нужно установить, иначе addItemToCurrentBox пропустит обновление в IndexedDB
        currentBox.value = {
          ...box,
          number: box.box_number || 0,
          items,
          backendId: box.id,
          createdAt: box.created_at || new Date().toISOString()
        }
        return currentBox.value
      } catch {
        return null
      }
    }

    /** Загрузка всех активных коробов из IndexedDB */
    async function loadAllActiveBoxes() {
      try {
        const result = await db.boxes.getAll()

        // Если ошибка или нет данных → currentBox НЕ может быть валидным → очищаем
        if (result.error || !result?.data || !Array.isArray(result.data)) {
          currentBox.value = null
          return []
        }

        const activeBoxes = result.data.filter((b) => b.status === 'active')

        // Если нет активных коробов в локальном хранилище → проверяем currentBox перед очисткой
        if (activeBoxes.length === 0) {
          // BUG-235 fix: не очищаем currentBox если он создан локально и ещё не синхронизирован
          if (currentBox.value && currentBox.value.backendId) {
            return [currentBox.value]
          }
          currentBox.value = null
          return []
        }

        // Очищаем currentBox если он больше не active в локальном хранилище (например, завершён)
        if (currentBox.value && !activeBoxes.some((b) => b.id === currentBox.value.id)) {
          currentBox.value = null
        }

        // Загружаем товары для каждого активного короба
        const boxesWithItems = await Promise.all(
          activeBoxes.map(async (box) => {
            const itemsResult = await db.boxItems.getByBoxId(box.id)
            const items = (itemsResult.data || []).map((item) => ({
              number: item.barcode,
              name: item.name,
              article: item.brand || '',
              comment: item.comment || '',
              scannedAt: item.created_at
            }))
            return { ...box, items, createdAt: box.created_at, backendId: box.id }
          })
        )

        return boxesWithItems
      } catch {
        return []
      }
    }

    /** Загрузка собранных (finished) коробов из локального хранилища */
    async function loadBoxes() {
      try {
        const result = await db.boxes.getAll()
        if (result.error) return []

        const finishedBoxesRaw = (result.data || []).filter((b) => b.status === 'finished')

        // Сохраняем Map загруженных items ПЕРЕЗ заменой массива — H3 fix: lazy-loaded items не теряются при reload
        const prevItemsMap = new Map()
        boxes.value.forEach((box) => {
          if (box.id && box.itemsLoaded && box.items?.length > 0) {
            prevItemsMap.set(box.id, [...box.items])
          }
        })

        // Lazy load: не грузим items для всех finished коробов — только базовые данные
        const boxesWithItems = finishedBoxesRaw
          .map((box) => {
            if (!box.id) return null
            // Восстанавливаем lazy-loaded items из предыдущего состояния если они есть
            const prevItems = prevItemsMap.get(box.id) || []
            return {
              id: box.id,
              number: box.box_number || box.number || 0,
              name: box.name,
              createdAt: box.created_at,
              status: box.status,
              items: prevItems.length > 0 ? prevItems : [], // restore если были загружены ранее
              itemsLoaded: prevItemsMap.has(box.id) // помечаем что items уже загружены
            }
          })
          .filter(Boolean)

        boxes.value = boxesWithItems
        return boxesWithItems
      } catch {
        return []
      }
    }

    /** Обновить items конкретного finished короба (lazy load) */
    async function refreshBoxItems(boxId) {
      try {
        const result = await db.boxItems.getByBoxId(boxId)
        const items = (result.data || []).map((item) => ({
          number: item.barcode,
          name: item.name,
          article: item.brand || '',
          comment: item.comment || '',
          scannedAt: item.created_at
        }))

        // Находим короб в массиве и обновляем items + флаг loaded
        const box = boxes.value.find((b) => b.id === boxId)
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
    CRUD операции — все идут напрямую в локальное хранилище
   ============================================================ */

    /** Создание нового короба */
    async function createBox() {
      // BUG-234 fix: проверяем что currentBox ещё не существует
      if (currentBox.value) {
        return currentBox.value
      }
      isSyncing.value = true
      syncError.value = null

      try {
        // Создаём короб в IndexedDB → получаем id
        const result = await db.boxes.create()
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
        showError(syncError.value, 'Ошибка создания микса')
        return null
      } finally {
        isSyncing.value = false
      }
    }

    /** Добавление товара в текущий короб */
    async function addItemToCurrentBox(item) {
      if (!currentBox.value) {
        return { success: false, error: 'Нет активного короба' }
      }

      const parsedItemNumber = parseBarcodeToBrainNumber(item.number)

      // Глобальная проверка дубликатов
      const globalDup = await checkGlobalDuplicate(item.number)
      if (globalDup) {
        return {
          success: false,
          error: 'duplicate_global',
          boxNumber: globalDup.boxNumber,
          boxName: globalDup.boxName,
          containerType: globalDup.type || 'box'
        }
      }

      const duplicateInCurrent = currentBox.value.items.find((i) => {
        const parsedI = parseBarcodeToBrainNumber(i.number)
        return (parsedI && parsedI === parsedItemNumber) || i.number === item.number
      })
      if (duplicateInCurrent) {
        return { success: false, error: 'duplicate_current' }
      }

      // Сохраняем состояние для undo
      const itemCopy = JSON.parse(
        JSON.stringify({
          ...item,
          scannedAt: new Date().toISOString()
        })
      )

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

      // Синхронизация добавления в короб (прямой PUT)
      if (currentBox.value.backendId) {
        try {
          const result = await db.boxes.update(currentBox.value.backendId, {
            item: {
              barcode: item.number,
              name: item.name,
              brand: item.article,
              comment: item.comment || ''
            }
          })

          if (result.error) {
            // Удаляем добавленный item по номеру, а не pop() — предотвращаем удаление не того элемента
            const itemIdx = currentBox.value.items.findIndex((i) => i.number === item.number)
            if (itemIdx !== -1) currentBox.value.items.splice(itemIdx, 1)
            const histIdx = actionHistory.value.findIndex(
              (a) => a.type === 'add_item' && a.item.number === item.number
            )
            if (histIdx !== -1) actionHistory.value.splice(histIdx, 1)

            // Проверяем на дубликат
            if (/duplicate/i.test(result.error.message || '') || result.error.code === 409) {
              const boxNumber =
                result.error.detail?.box_number || result.error.box_number || 'неизвестен'
              return { success: false, error: 'duplicate_server', boxNumber }
            }
            syncError.value = `Не синхронизировано: ${result.error.message}`
            showError(result.error.message, 'Не удалось сохранить товар')
            return { success: false }
          }
        } catch (error) {
          currentBox.value.items.pop()
          actionHistory.value.pop()
          syncError.value = `Не синхронизировано: ${error.message}`
          showError(error.message, 'Не удалось сохранить товар')
        }
      }

      return { success: true }
    }

    /** Проверка глобального дубликата (в других коробах и паллетах) — H3: один pass с нормализацией */
    async function checkGlobalDuplicate(scannedBarcode) {
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
              return { boxNumber: box.number, boxName: box.name, type: 'box' }
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
              return { boxNumber: currentBox.value.number, boxName: 'текущий', type: 'box' }
            }
          }
        }
      }

      // DB-фолбэк: inline-товары в паллетах (включая завершённые) — стор коробов их
      // не видит, а уникального индекса по barcode у pallet_items нет. Без этого
      // товар из паллеты можно повторно добавить в микс (дубль).
      try {
        const found = await db.palletItems.findInlineByBarcode([...searchNumbers], null)
        if (found?.data?.pallet_number != null) {
          return {
            boxNumber: found.data.pallet_number,
            boxName: found.data.pallet_name,
            type: 'pallet'
          }
        }
      } catch {
        // ignore — in-memory проверка выше уже отработала
      }

      return null
    }

    /** Завершение текущего короба */
    async function finishCurrentBox() {
      if (!currentBox.value || currentBox.value.items.length === 0) return null
      if (isSyncing.value) return null

      isSyncing.value = true
      syncError.value = null

      const originalCurrentBox = JSON.parse(JSON.stringify(currentBox.value))
      console.warn('[FINISH.DIAG] start', {
        id: originalCurrentBox.id,
        backendId: originalCurrentBox.backendId,
        status: originalCurrentBox.status,
        items: originalCurrentBox.items.length,
        hasItems: !!originalCurrentBox.items?.length
      })

      try {
        const backendId = originalCurrentBox.backendId

        // Завершаем короб (PUT status=finished) и получаем items
        if (backendId) {
          const updateResult = await db.boxes.update(backendId, { status: 'finished' })
          console.warn('[FINISH.DIAG] after db.boxes.update', {
            ok: !!updateResult.data,
            error: updateResult.error ? updateResult.error.message : null
          })

          if (updateResult.error) throw new Error(updateResult.error.message)

          // Читаем items из IndexedDB для экспорта
          const originalItemsSnapshot = JSON.parse(JSON.stringify(originalCurrentBox.items))

          const itemsResult = await db.boxItems.getByBoxId(backendId)

          const serverItems = (itemsResult.data || []).map((item) => ({
            number: item.barcode,
            name: item.name,
            article: item.brand || '',
            comment: item.comment || '',
            scannedAt: item.created_at || '' // C4: fallback на пустую строку если нет created_at
          }))

          // C4: merge — по barcode, а не по индексу (BUG-212 fix)
          const mergedItems =
            serverItems.length > 0
              ? (() => {
                  if (!originalCurrentBox.items.length) return serverItems
                  const byBarcode = new Map(serverItems.map((si) => [si.number, si]))
                  return originalItemsSnapshot.map((origItem) => {
                    const serverItem = byBarcode.get(origItem.number)
                    return serverItem
                      ? {
                          ...serverItem,
                          scannedAt: serverItem.scannedAt || origItem.scannedAt || ''
                        }
                      : origItem
                  })
                })()
              : originalItemsSnapshot

          // Добавляем в локальный массив (данные из IndexedDB)
          const finishedBoxWithBackend = {
            ...originalCurrentBox,
            backendId,
            status: 'finished',
            items: mergedItems
          }
          boxes.value.push(finishedBoxWithBackend)

          // Очищаем currentBox и возвращаем УСПЕШНЫЙ короб (из IndexedDB)
          currentBox.value = null
          return finishedBoxWithBackend
        } else {
          boxes.value.push({ ...originalCurrentBox, status: 'finished' })
          currentBox.value = null
          return originalCurrentBox
        }
      } catch (error) {
        console.error('[FINISH.DIAG] CAUGHT', {
          message: error.message,
          stack: error.stack,
          name: error.name
        })
        syncError.value = `Не удалось завершить короб: ${error.message}`

        // Обработка ошибки «создан» — восстанавливаем состояние через showError
        if (error.message?.includes('создан')) {
          showError(error.message, 'Ошибка завершения короба')
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
            (item) => item.number === lastAction.item.number
          )
          if (itemIndex !== -1) {
            const itemToRemove = currentBox.value.items[itemIndex]
            currentBox.value.items.splice(itemIndex, 1)

            // Удаление из хранилища
            if (currentBox.value.backendId) {
              try {
                await db.boxItems.deleteItem(currentBox.value.backendId, itemToRemove.number)
              } catch {
                // Rollback при ошибке
                currentBox.value.items.splice(itemIndex, 0, itemToRemove)
              }
            }
          }
        }
      }

      return lastAction.item
    }

    /** Удаление товара из текущего короба */
    async function removeItemFromCurrentBox(item) {
      if (!currentBox.value) return { success: false, error: 'Нет активного короба' }

      const itemIndex = currentBox.value.items.findIndex((i) => i.number === item.number)
      if (itemIndex === -1) return { success: false, error: 'Товар не найден' }

      const removedItem = currentBox.value.items[itemIndex]
      currentBox.value.items.splice(itemIndex, 1)

      if (currentBox.value.backendId) {
        try {
          await db.boxItems.deleteItem(currentBox.value.backendId, removedItem.number)
        } catch {
          currentBox.value.items.splice(itemIndex, 0, removedItem)
          return { success: false, error: 'Не удалось удалить' }
        }
      }

      return { success: true }
    }

    async function cancelCurrentBox() {
      if (!currentBox.value || !currentBox.value.backendId) {
        currentBox.value = null
        return { success: true, cleared: 0 }
      }

      const itemsToDelete = [...(currentBox.value.items || [])]
      await Promise.all(
        itemsToDelete.map((item) =>
          db.boxItems.deleteItem(currentBox.value.id, item.number).catch(() => {})
        )
      )

      currentBox.value.items = []
      // История отмены больше не актуальна — сброшенные товары вернуть нельзя
      actionHistory.value = []
      return { success: true, cleared: itemsToDelete.length }
    }

    /** Получение всех товаров из всех коробов */
    function getAllBoxItems() {
      const allItems = []
      boxes.value.forEach((box) => {
        box.items.forEach((item) => {
          allItems.push({ ...item, boxName: box.name, boxNumber: box.number })
        })
      })
      if (currentBox.value) {
        currentBox.value.items.forEach((item) => {
          allItems.push({
            ...item,
            boxName: currentBox.value.name,
            boxNumber: currentBox.value.number
          })
        })
      }
      return allItems
    }

    /** Удалить один короб из списка */
    async function deleteBox(boxId) {
      const box = boxes.value.find((b) => b.id === boxId)
      if (!box) return { success: false, error: 'Короб не найден' }

      // Проверяем статус — только finished
      if (box.status !== 'finished') {
        return { success: false, error: 'Можно удалить только завершённый короб' }
      }

      // Удаляем из хранилища
      let backendOk = true
      try {
        const result = await db.boxes.delete(boxId)
        if (result.error) {
          backendOk = false
        }
      } catch {
        backendOk = false
      }

      const idx = boxes.value.findIndex((b) => b.id === boxId)
      if (idx !== -1) boxes.value.splice(idx, 1)

      return { success: true, backendSynced: backendOk }
    }

    /** Очистка всех коробов — и active, и finished */
    async function clearAllBoxes() {
      return clearAllWithAdminCheck(
        async () => {
          const activeResult = await db.boxes.clearAllFinished({ active: true })
          if (activeResult?.error) return activeResult
          return db.boxes.clearAllFinished()
        },
        () => {
          boxes.value = []
          currentBox.value = null
        },
        isSyncing
      )
    }

    /** Очистка завершённых коробов — только finished (не active!) */
    function clearAllBoxesFromBackend() {
      boxes.value = boxes.value.filter((b) => b.status === 'active')
      window.showToast('🗑 Короба удалены в локальном хранилище')
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
      refreshBoxItems
    }
  },
  { persist: false }
) // отключён Pinia persist — приложение работает только локально
