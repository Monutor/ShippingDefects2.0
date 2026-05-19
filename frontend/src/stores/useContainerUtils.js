import { computed } from 'vue'
import { isAdmin as checkIsAdmin } from '@/config'

/**
 * Общие утилиты для контейнерных stores (boxes, separate).
 * Извлекает дублирующуюся логику: computed, offline queue, clearAll.
 */

/**
 * Computed: есть ли действия для отмены.
 */
export function useCanUndo(actionHistory) {
  return computed(() => actionHistory.value.length > 0)
}

/**
 * Computed: последний добавленный товар (для UI-подсветки).
 */
export function useLastScannedItem(actionHistory) {
  return computed(() => {
    if (actionHistory.value.length === 0) return null
    const lastAction = actionHistory.value[actionHistory.value.length - 1]
    return lastAction.type === 'add_item' ? lastAction.item : null
  })
}

/**
 * Очищает офлайн-очередь от записей старше TTL.
 * @param {Ref} queue — очередь записей с полем timestamp
 * @param {number} ttlMs — TTL в миллисекундах (по умолчанию 24 часа)
 */
export function purgeExpiredQueueEntries(queue, ttlMs = 24 * 60 * 60 * 1000) {
  const now = Date.now()
  queue.value = queue.value.filter((entry) => {
    if (entry.timestamp && now - entry.timestamp > ttlMs) {
      return false
    }
    return true
  })
}

/**
 * Отправляет офлайн-очередь на сервер при восстановлении сети.
 * @param {Ref} queue — очередь записей
 * @param {Function} syncFn — async (entry) => Promise<void> — функция синхронизации одной записи
 * @param {Function} isDuplicateFn — (err) => boolean — проверка что ошибка = дубликат
 * @param {number} ttlMs — TTL для записей
 */
export async function flushOfflineQueue(queue, syncFn, isDuplicateFn, ttlMs = 24 * 60 * 60 * 1000) {
  if (!navigator.onLine || queue.value.length === 0) return

  purgeExpiredQueueEntries(queue, ttlMs)
  if (queue.value.length === 0) return

  const queued = [...queue.value]
  queue.value = []

  for (const entry of queued) {
    try {
      await syncFn(entry)
    } catch (err) {
      if (isDuplicateFn(err)) {
        // Дубликат — не возвращаем в очередь
      } else if (queue.value.length > 0) {
        queue.value.unshift(entry)
      }
    }
  }
}

/**
 * Очистка всех данных с проверкой прав администратора.
 * @param {Function} dbClearFn — async () => Promise<{error?}> — функция очистки на сервере
 * @param {Function} onClearLocal — () => void — очистка локального состояния
 * @param {Ref} isSyncing — ref синхронизации
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function clearAllWithAdminCheck(dbClearFn, onClearLocal, isSyncing) {
  if (!checkIsAdmin()) {
    window.showToast('⚠️ Очищать общую базу может только администратор')
    return { success: false, error: 'Только админ' }
  }

  isSyncing.value = true
  try {
    const result = await dbClearFn()
    if (result?.error) {
      window.showToast('❌ Ошибка очистки серверной базы')
      return { success: false, error: result.error.message }
    }
    onClearLocal()
    return { success: true }
  } catch (error) {
    window.showToast('❌ Ошибка очистки базы')
    return { success: false, error: error.message }
  } finally {
    isSyncing.value = false
  }
}
