import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * Store для хранения данных сборщика (in-memory only).
 * Данные восстанавливаются из auth session (warehouse-brain-user) на старте.
 */
export const useCollectorStore = defineStore('collector', () => {
  // Должность сборщика
  const position = ref('')

  // ФИО сборщика
  const fullName = ref('')

  // Табельный номер
  const employeeId = ref('')

  // Вычисляемое: заполнены ли данные
  const isInitialized = computed(() => {
    return position.value.trim() !== '' && fullName.value.trim() !== ''
  })

  /** Восстановить профиль из auth session (warehouse-brain-user) */
  function restoreFromAuthSession() {
    try {
      const userStr = localStorage.getItem('warehouse-brain-user')
      if (!userStr) return false
      const user = JSON.parse(userStr)
      if (!user.employeeId) return false

      // Восстанавливаем только если store ещё пустой (не был установлен при логине)
      if (!position.value && !fullName.value) {
        setCollectorData({
          employeeId: user.employeeId,
          fullName: user.fullName || '',
          position: user.position || ''
        })
        return true
      }
    } catch {
      /* ignore */
    }
    return false
  }

  /**
   * Установка данных сборщика
   */
  function setCollectorData(data) {
    position.value = data.position?.trim() || ''
    fullName.value = data.fullName?.trim() || ''
    employeeId.value = data.employeeId?.trim() || ''
  }

  /**
   * Очистка данных
   */
  function clearData() {
    position.value = ''
    fullName.value = ''
    employeeId.value = ''
  }

  return {
    position,
    fullName,
    employeeId,
    isInitialized,
    setCollectorData,
    clearData,
    restoreFromAuthSession
  }
})
