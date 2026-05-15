import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { maintenance as mApi } from '@/lib/api.js'

/** SSE EventSource для maintenance mode */
let eventSource = null
const EVENT_SOURCE_URL = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'}/api/sync`

/**
 * Store для управления режимом технических работ (server-first + SSE push).
 */
export const useMaintenanceStore = defineStore('maintenance', () => {
  const isEnabled = ref(false)
  const isLoading = ref(true)

  // Вычисляемое: статус загрузки
  const loadStatus = computed(() => ({
    isLoading: isLoading.value,
    error: null
  }))

  /** Загрузка состояния из бэкенда */
  async function loadFromBackend() {
    let serverLoaded = false

    if (navigator.onLine) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      try {
        const result = await mApi.load(controller.signal)
        clearTimeout(timeoutId)

        if (!result.error && result.data) {
          isEnabled.value = result.data.maintenance_mode === true || result.data.value === 'true'
          serverLoaded = true
        }
      } catch (err) {
        console.warn('Не удалось загрузить maintenance mode:', err.message)
      }
    }

    // Убрали localStorage fallback — если сервер не ответил, conservative default = false
    isLoading.value = false

    // Инициализируем глобальное состояние для router guard
    if (typeof window.__setMaintenanceMode === 'function') {
      window.__setMaintenanceMode(isEnabled.value, false)
    }
  }

  /** Сохранение состояния в бэкенд */
  async function saveToBackend() {
    if (navigator.onLine) {
      try {
        await mApi.save(isEnabled.value)
        console.log('✅ Maintenance mode сохранён:', isEnabled.value ? 'ВКЛ' : 'ВЫКЛ')
      } catch (err) {
        // Убрали localStorage fallback — если сервер недоступен, просто логируем
        console.warn('Не удалось сохранить maintenance mode на бэкенд:', err.message)
      }
    } else {
      console.warn('Нет подключения: maintenance mode не сохранён')
    }
  }

  /** Подписка на realtime обновления через SSE */
  function subscribeToChanges() {
    if (eventSource) return // Уже подписан

    try {
      eventSource = new EventSource(EVENT_SOURCE_URL)

      eventSource.addEventListener('init', (e) => {
        const data = JSON.parse(e.data)
        isEnabled.value = data.maintenanceMode || false
        // Убрали localStorage write — только server state
        // Синхронизируем с router guard
        if (typeof window.__setMaintenanceMode === 'function') {
          window.__setMaintenanceMode(isEnabled.value, false)
        }
        console.log('📡 SSE init:', isEnabled.value ? 'ВКЛ' : 'ВЫКЛ')
      })

      eventSource.addEventListener('maintenance_mode_changed', (e) => {
        const data = JSON.parse(e.data)
        isEnabled.value = data.enabled || false
        // Убрали localStorage write — только server state
        // Синхронизируем с router guard
        if (typeof window.__setMaintenanceMode === 'function') {
          window.__setMaintenanceMode(isEnabled.value, false)
        }
        console.log(`🔄 Maintenance mode обновлён через SSE: ${isEnabled.value ? 'ВКЛ' : 'ВЫКЛ'}`)
      })

      eventSource.onerror = () => {
        console.error('❌ SSE connection error')
        // EventSource auto-reconnects, no need to handle manually
      }
    } catch (err) {
      console.error('SSE init failed:', err.message)
    }
  }

  /** Отписка от realtime */
  function unsubscribeFromChanges() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
      console.log('❌ SSE подписка отключена')
    }
  }

  /** Очистка при уничтожении стора */
  function destroy() {
    unsubscribeFromChanges()
  }

  async function enableMaintenance() {
    isEnabled.value = true
    await saveToBackend()
  }

  async function disableMaintenance() {
    isEnabled.value = false
    await saveToBackend()
  }

  async function toggleMaintenance() {
    isEnabled.value = !isEnabled.value
    isLoading.value = true
    try {
      await saveToBackend()
    } catch (err) {
      // Откат на предыдущее значение при ошибке
      isEnabled.value = !isEnabled.value
      console.error('❌ Не удалось сохранить maintenance mode:', err.message)
    } finally {
      isLoading.value = false
    }
  }

  return {
    isEnabled,
    isLoading,
    loadStatus,
    loadFromBackend,
    saveToBackend,
    subscribeToChanges,
    unsubscribeFromChanges,
    enableMaintenance,
    disableMaintenance,
    toggleMaintenance,
    destroy
  }
})
