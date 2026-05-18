import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db, auth } from '@/lib/api.js'
import { logScan } from '@/utils/sync'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { isAdmin as checkIsAdmin } from '@/config'

/**
 * Store для отдельных товаров (независимые товары, не привязанные к контейнерам).
 * server-first: данные хранятся на сервере. localStorage — только сессия + UI.
 */
export const useSeparateStore = defineStore('separate', () => {
  // Массив отдельных товаров
  const items = ref([])

  // История действий для undo (максимум 50 действий)
  const actionHistory = ref([])
  const MAX_HISTORY = 50

  // Очередь офлайн удалений — M6/M7 fix: сохраняем удаления когда нет сети
  const pendingOfflineDeletes = ref([])

  // Статус синхронизации
  const isSyncing = ref(false)
  const syncError = ref(null)

  // Вычисляемое: количество отдельных товаров
  const totalItems = computed(() => items.value.length)

  // Вычисляемое: есть ли действия для отмены
  const canUndo = computed(() => actionHistory.value.length > 0)

  // Вычисляемое: последний отсканированный товар (для UI)
  const lastScannedItem = computed(() => {
    if (actionHistory.value.length === 0) return null
    const lastAction = actionHistory.value[actionHistory.value.length - 1]
    return lastAction.type === 'add_item' ? lastAction.item : null
  })

  /* ============================================================
   Загрузка данных с сервера
   ============================================================ */

  /** Загрузка отдельных товаров с бэкенда */
  async function loadSeparateItems() {
    try {
      if (!navigator.onLine) return []

      const result = await db.separateItems.getAll()
      if (result.error) return []

      const sorted = (result.data || []).sort((a, b) => (b.id || 0) - (a.id || 0))

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

    // Синхронизация с бэкендом (прямой POST)
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

      // Сохраняем серверный ID в добавленный item (unshift = позиция 0)
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
      window.showToast(`⚠️ Не удалось сохранить: ${error.message}`)
    } finally {
      isSyncing.value = false
    }

    return { success: true }
  }

  /** Удаление товара из списка (optimistic + rollback) */
  async function removeItem(index) {
    const itemToRemove = items.value[index]
    if (!itemToRemove) return false

    // M7 fix: если онлайн — удаляем и сразу отправляем на сервер; если офлайн — queue
    if (navigator.onLine) {
      try {
        const result = await db.separateItems.deleteById(itemToRemove.number)
        if (result.error) throw new Error(result.error.message)
      } catch (err) {
        // BUG-22 fix: rollback — возвращаем товар на место при ошибке сервера
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
    } else {
      pendingOfflineDeletes.value.push({ item: JSON.parse(JSON.stringify(itemToRemove)), index })
    }

    // BUG-210 fix: splice выполняется после завершения серверной операции
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
        // M6 fix: если офлайн — НЕ удаляем actionHistory, queue для синхронизации позже
        if (!navigator.onLine) {
          pendingOfflineDeletes.value.push({
            item: JSON.parse(JSON.stringify(lastAction.item)),
            index: itemIndex
          })
          // Удаляем локально (optimistic)
          items.value.splice(itemIndex, 1)
          items.value.forEach((item, idx) => {
            item.placeNumber = idx + 1
          })
          return lastAction.item
        }

        const itemToRemove = items.value[itemIndex]

        // Удаляем локально и отправляем на сервер синхронно
        actionHistory.value.pop() // pop'ем только если онлайн — можем rollback при ошибке
        items.value.splice(itemIndex, 1)
        items.value.forEach((item, idx) => {
          item.placeNumber = idx + 1
        })

        try {
          const result = await db.separateItems.deleteById(itemToRemove.id || itemToRemove.number)
          if (result.error) throw new Error(result.error.message)
        } catch (err) {
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

  /** Очистить весь список на сервере и локально */
  async function clearAll() {
    if (!checkIsAdmin()) {
      window.showToast('⚠️ Только администратор может очистить все данные')
      return false
    }
    if (navigator.onLine) {
      try {
        const result = await db.separateItems.clearAll()
        if (result.error) throw new Error(result.error.message)
      } catch {
        // ignore
      }
    }
    items.value = []
    actionHistory.value = [] // L1 fix: сбрасываем историю при очистке
    pendingOfflineDeletes.value = [] // очищаем очередь удалений тоже
    return true
  }

  /** Flush offline deletes queue — BUG-6 fix: отправляем накопленные офлайн удаления на сервер */
  async function flushPendingOfflineDeletes() {
    if (!navigator.onLine || pendingOfflineDeletes.value.length === 0) return
    const queued = [...pendingOfflineDeletes.value]
    pendingOfflineDeletes.value = []

    const TTL = 24 * 60 * 60 * 1000 // 24 часа
    const now = Date.now()

    for (const entry of queued) {
      // BUG-216 fix: TTL для офлайн deletes — удаляем старые записи
      if (entry.timestamp && now - entry.timestamp > TTL) {
        continue
      }
      try {
        await db.separateItems.deleteById(entry.item.id || entry.item.number)
      } catch (err) {
        if (err?.code === '404' || err?.statusCode === 404) {
        } else {
          pendingOfflineDeletes.value.unshift(entry)
        }
      }
    }
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
    loadSeparateItems,
    flushPendingOfflineDeletes // BUG-6 fix: export для main.js online handler
  }
})
