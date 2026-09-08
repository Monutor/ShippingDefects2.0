import { computed } from 'vue'
import { isAdmin as checkIsAdmin } from '@/config'

/**
 * Общие утилиты для контейнерных stores (boxes, separate).
 * Извлекает дублирующуюся логику: computed, clearAll.
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
 * Очистка всех данных.
 * @param {Function} dbClearFn — async () => Promise<{error?}> — функция очистки в локальном хранилище
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
      window.showToast('❌ Ошибка очистки локального хранилища')
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
