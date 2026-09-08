import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { dbStore as db } from '@/lib/db.js'
import { logScan } from '@/utils/sync'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { showError } from '@/utils/showError'
import { useCanUndo, useLastScannedItem, clearAllWithAdminCheck } from './useContainerUtils'

/**
 * Store для отдельных товаров (независимые товары, не привязанные к контейнерам).
 * Данные хранятся в IndexedDB. localStorage — только сессия + UI.
 */
export const useSeparateStore = defineStore('separate', () => {
  // Массив отдельных товаров
  const items = ref([])

  // История действий для undo (максимум 50 действий)
  const actionHistory = ref([])
  const MAX_HISTORY = 50

  // Статус синхронизации
  const isSyncing = ref(false)
  const syncError = ref(null)

  // Вычисляемое: количество отдельных товаров
  const totalItems = computed(() => items.value.length)

  // Вычисляемые из shared utils
  const canUndo = useCanUndo(actionHistory)
  const lastScannedItem = useLastScannedItem(actionHistory)

  /* ============================================================
    Загрузка данных из IndexedDB
   ============================================================ */

  /** Загрузка отдельных товаров из IndexedDB */
  async function loadSeparateItems() {
    try {
      const result = await db.separateItems.getAll()
      if (result.error) return []

      // id теперь строковый UUID — сортируем по created_at (новые сверху)
      const sorted = (result.data || []).sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || ''))
      )

      items.value = sorted.map((item, idx) => ({
        id: item.id,
        number: item.barcode,
        name: item.brain_name || item.name || 'Без названия',
        article: item.brain_brand || item.brand || '',
        comment: item.brain_comment || item.comment || '',
        is_stop_item: item.is_stop_item || false,
        scannedAt: item.created_at || null,
        placeNumber: sorted.length - idx
      }))

      return items.value
    } catch {
      return []
    }
  }

  /** Добавление отдельного товара */
  async function addItem(item) {
    // M2 fix: consistent duplicate detection с isDuplicate — используем parseBarcode
    const parsed = parseBarcodeToBrainNumber(item.number)
    const duplicate = items.value.find((i) => {
      if (i.number === item.number) return true
      const iParsed = parseBarcodeToBrainNumber(i.number)
      return iParsed && parsed && iParsed === parsed
    })
    if (duplicate) {
      return { success: false, error: 'duplicate' }
    }

    // Кросс-проверка по БД: товар не должен уже лежать в миксе или паллете
    // (включая завершённые — в память стора они не загружаются).
    // Без этого товар из микса/паллеты можно повторно добавить в «Отдельные» (дубль).
    const searchNumbers = new Set([item.number])
    if (parsed && parsed !== item.number) searchNumbers.add(parsed)
    try {
      const foundBox = await db.boxItems.findByBarcode([...searchNumbers])
      if (foundBox?.data?.box_number != null) {
        return {
          success: false,
          error: 'duplicate_in_box',
          containerNumber: foundBox.data.box_number,
          containerName: foundBox.data.box_name
        }
      }
    } catch {
      // ignore — in-memory проверка выше уже отработала
    }
    try {
      const foundPallet = await db.palletItems.findInlineByBarcode([...searchNumbers], null)
      if (foundPallet?.data?.pallet_number != null) {
        return {
          success: false,
          error: 'duplicate_in_pallet',
          containerNumber: foundPallet.data.pallet_number,
          containerName: foundPallet.data.pallet_name
        }
      }
    } catch {
      // ignore
    }

    // Сохраняем состояние для undo
    const itemCopy = JSON.parse(
      JSON.stringify({
        ...item,
        scannedAt: new Date().toISOString(),
        placeNumber: items.value.length + 1
      })
    )

    // Добавляем товар локально (optimistic update) — unshift = в начало списка
    const pushIndex = 0 // M5 fix: запоминаем индекс для точного rollback вместо pop()
    items.value.unshift(itemCopy)

    // Обновляем placeNumber для всех товаров
    items.value.forEach((i, idx) => {
      i.placeNumber = idx + 1
    })

    // Добавляем в историю действий
    actionHistory.value.push({
      type: 'add_item',
      item: itemCopy,
      timestamp: Date.now()
    })

    if (actionHistory.value.length > MAX_HISTORY) {
      actionHistory.value.shift()
    }

    // Локальное сохранение товара в хранилище
    isSyncing.value = true
    syncError.value = null
    try {
      const result = await db.separateItems.add({
        barcode: itemCopy.number,
        name: itemCopy.name,
        brand: itemCopy.article || '',
        model: '',
        defect_type: '',
        comment: itemCopy.comment || ''
      })

      if (result.error) throw new Error(result.error.message)

      // Сохраняем локальный ID в добавленный item (unshift = позиция 0)
      const lastItem = items.value[0]
      if (lastItem && result.data?.id != null) {
        lastItem.id = result.data.id
      }

      logScan({
        barcode: item.number,
        itemNumber: item.number,
        itemName: item.name,
        action: 'added',
        boxId: null
      })
    } catch (error) {
      syncError.value = `Не удалось синхронизировать: ${error.message}`
      // M5 fix: rollback конкретного элемента по индексу вместо pop() — при WS обновлениях от других клиентов pop() удалит не тот элемент
      items.value.splice(pushIndex, 1)
      actionHistory.value.pop()
      const msg = error?.message || ''
      const isDbDuplicate =
        error?.name === 'ConstraintError' || /constraint|unique|already exists|duplicate/i.test(msg)
      if (isDbDuplicate) {
        // Строка уже есть в БД (unique &barcode), но её не было в памяти.
        // Подтягиваем истину из БД и отдаём «дубликат», а не ложный успех —
        // иначе вьюха покажет «✓ Добавлено», хотя товар откачен.
        try {
          await loadSeparateItems()
        } catch {
          // ignore — список останется как есть
        }
        return { success: false, error: 'duplicate' }
      }
      showError(error.message, 'Не удалось сохранить товар')
      return { success: false, error: 'save_failed' }
    } finally {
      isSyncing.value = false
    }

    return { success: true }
  }

  /** Удаление товара из списка (optimistic + rollback) */
  async function removeItem(index) {
    const itemToRemove = items.value[index]
    if (!itemToRemove) return false

    try {
      const result = await db.separateItems.deleteById(itemToRemove.number)
      if (result.error) throw new Error(result.error.message)
    } catch {
      // BUG-22 fix: rollback — возвращаем товар на место при ошибке
      const actualIndex = items.value.findIndex((i) => i.number === itemToRemove.number)
      if (actualIndex !== -1) {
        items.value.splice(actualIndex, 0, itemToRemove)
      }
      items.value.forEach((item, idx) => {
        item.placeNumber = idx + 1
      })
      syncError.value = 'Не удалось удалить — данные восстановлены'
      return false
    }

    // BUG-210 fix: splice выполняется после завершения операции
    // Удаляем по ссылке, а не по индексу — предотвращаем race condition
    const actualIndex = items.value.findIndex((i) => i.number === itemToRemove.number)
    if (actualIndex !== -1) {
      items.value.splice(actualIndex, 1)
    }
    items.value.forEach((item, idx) => {
      item.placeNumber = idx + 1
    })

    return true
  }

  /** Отмена последнего действия */
  async function undoLastAction() {
    if (actionHistory.value.length === 0) return null

    const lastAction = actionHistory.value[actionHistory.value.length - 1] // M6 fix: не pop'ем сразу — если офлайн, сохраним возможность rollback

    if (lastAction.type === 'add_item') {
      const itemIndex = items.value.findIndex((item) => item.number === lastAction.item.number)
      if (itemIndex !== -1) {
        const itemToRemove = items.value[itemIndex]

        // Удаляем локально — можем rollback при ошибке
        actionHistory.value.pop()
        items.value.splice(itemIndex, 1)
        items.value.forEach((item, idx) => {
          item.placeNumber = idx + 1
        })

        try {
          const result = await db.separateItems.deleteById(itemToRemove.number)
          if (result.error) throw new Error(result.error.message)
        } catch {
          // Rollback: возвращаем товар на место и восстанавливаем actionHistory
          items.value.splice(itemIndex, 0, itemToRemove)
          items.value.forEach((item, idx) => {
            item.placeNumber = idx + 1
          })
          actionHistory.value.push(lastAction)
          syncError.value = 'Не удалось отменить — данные восстановлены'
          return null
        }

        return lastAction.item
      }
    }

    return null
  }

  /** Проверка дубликата */
  function isDuplicate(barcode) {
    const parsed = parseBarcodeToBrainNumber(barcode)
    return items.value.some((item) => item.number === barcode || (parsed && item.number === parsed))
  }

  /** Очистить весь список в локальном хранилище */
  async function clearAll() {
    return clearAllWithAdminCheck(
      () => db.separateItems.clearAll(),
      () => {
        items.value = []
        actionHistory.value = []
      },
      isSyncing
    )
  }

  return {
    items,
    actionHistory,
    totalItems,
    canUndo,
    lastScannedItem,
    isSyncing,
    syncError,
    addItem,
    removeItem,
    undoLastAction,
    isDuplicate,
    clearAll,
    loadSeparateItems
  }
})
