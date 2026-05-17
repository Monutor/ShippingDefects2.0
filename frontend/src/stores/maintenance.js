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
      } catch (err) {
      }
    } else {
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
      })

      eventSource.addEventListener('maintenance_mode_changed', (e) => {
        const data = JSON.parse(e.data)
        isEnabled.value = data.enabled || false
        if (typeof window.__setMaintenanceMode === 'function') {
          window.__setMaintenanceMode(isEnabled.value, false)
        }
      })

      eventSource.onerror = () => {
      }
    } catch (err) {
    }
  }

  /** Отписка от realtime */
  function unsubscribeFromChanges() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  async function toggleMaintenance() {
    isEnabled.value = !isEnabled.value
    isLoading.value = true
    try {
      await saveToBackend()
    } catch (err) {
      isEnabled.value = !isEnabled.value
    } finally {
      isLoading.value = false
    }
  }

  return {
    isEnabled,
    isLoading,
    loadFromBackend,
    saveToBackend,
    subscribeToChanges,
    unsubscribeFromChanges,
    toggleMaintenance
  }
})
