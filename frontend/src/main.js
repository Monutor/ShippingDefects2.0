import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import App from './App.vue'
import router from './router'

// Tailwind CSS
import './styles/tailwind.css'
// Кастомные стили
import './assets/main.css'

// Устанавливаем класс dark для тёмной темы
document.documentElement.classList.add('dark')

const app = createApp(App)
const pinia = createPinia()

// Подключаем плагин персистентности для Pinia (только для сессии и UI-состояния)
pinia.use(piniaPluginPersistedstate)

// Глобальная регистрация UI-компонентов
import * as UIComponents from '@/components/ui'
Object.entries(UIComponents).forEach(([name, component]) => {
  app.component(name, component)
})

// Глобальная регистрация van-icon (только иконки из Vant)
import { Icon } from 'vant'
import 'vant/lib/icon/index.css'
app.component('VanIcon', Icon)

// ============================================
// Очистка кэша Service Worker (ТОЛЬКО для разработки)
// ============================================
if ('serviceWorker' in navigator && import.meta.env.DEV) {
  caches.keys().then(cacheNames => {
    cacheNames.forEach(cacheName => {
      console.log('🗑️ [DEV] Очистка кэша:', cacheName)
      caches.delete(cacheName)
    })
  })

  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => {
      console.log('⚠️ [DEV] Unregister Service Worker')
      registration.unregister()
    })
  })
}

// ============================================
// Offline listener — показываем banner при потере сети
// ============================================
let isOffline = false

function showOfflineBanner(show) {
  if (show && !isOffline) {
    console.log('📡 Офлайн: данные сохраняются локально')
    window.showToast('⚠️ Нет подключения к сети')
    // Dispatch event for App.vue to update reactive state
    window.dispatchEvent(new CustomEvent('network-status', { detail: { online: false } }))
    isOffline = true
  } else if (!show && isOffline) {
    console.log('📡 Онлайн: синхронизация возобновлена')
    window.dispatchEvent(new CustomEvent('network-status', { detail: { online: true } }))
    isOffline = false
  }
}

window.addEventListener('offline', () => showOfflineBanner(true))
window.addEventListener('online', async () => {
  showOfflineBanner(false)
  // BUG-4/BUG-6 fix: flush pending offline queues when network restores
  try {
    const { useBoxesStore } = await import('@/stores/boxes')
    const { useSeparateStore } = await import('@/stores/separate')
    const boxesStore = useBoxesStore()
    const separateStore = useSeparateStore()
    // Flush offline box items queue (BUG-4)
    if (boxesStore.flushPendingOfflineBoxItems) {
      await boxesStore.flushPendingOfflineBoxItems()
    }
    // Flush offline separate deletes queue (BUG-6)
    if (separateStore.flushPendingOfflineDeletes) {
      await separateStore.flushPendingOfflineDeletes()
    }
  } catch {}
})

// ============================================
// Server-first: автозагрузка всех данных при старте (только не на /login)
// ============================================
import { useBrainStore } from '@/stores/brain'
import { useBoxesStore } from '@/stores/boxes'
import { useSeparateStore } from '@/stores/separate'
import { usePalletStore } from '@/stores/pallet'

async function initializeApp() {
  const brainStore = useBrainStore()
  const boxesStore = useBoxesStore()
  const separateStore = useSeparateStore()
  const palletStore = usePalletStore()

  // Восстановить collector profile из auth session (warehouse-brain-user)
  try {
    const { useCollectorStore } = await import('@/stores/collector')
    const collectorStore = useCollectorStore()
    collectorStore.restoreFromAuthSession()
  } catch {}

  // Все данные загружаются параллельно — один упавший load не ломает остальные
  const results = await Promise.allSettled([
    brainStore.loadFromBackend(),
    boxesStore.loadBoxes(),
    boxesStore.loadActiveBox(),
    separateStore.loadSeparateItems(),
    palletStore.loadPallets()
  ])

  // FIX: логируем ошибки которые были скрыты в allSettled — показываем banner если критические загрузки провалились
  const criticalFailures = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      console.warn(`⚠️ Инициализация #${i + 1} провалилась:`, results[i].reason)
      const names = ['brain', 'boxes', 'activeBox', 'separate', 'pallet']
      if (['brain', 'boxes'].includes(names[i])) {
        criticalFailures.push(names[i])
      }
    }
  }

  // Если критические загрузки провалились — показываем предупреждение пользователю
  if (criticalFailures.length > 0) {
    window.showToast(`⚠️ Не удалось загрузить: ${criticalFailures.join(', ')}. Данные будут загружены позже.`, 10000, 'warning')
  }

  // Периодическая синхронизация активного короба (каждые 5 минут)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (boxesStore.currentBox && uuidRegex.test(boxesStore.currentBox.id)) {
    setInterval(() => {
      if (navigator.onLine) boxesStore.loadBoxes()
    }, 300000) // каждые 5 минут
  }

  console.log('✅ Server-first инициализация завершена')
}

app.use(pinia)
app.use(router)

// Запускаем инициализацию после монтирования, если не на /login
router.isReady().then(() => {
  if (router.currentRoute.value.path !== '/login') {
    initializeApp()
  }
})

app.mount('#app')
