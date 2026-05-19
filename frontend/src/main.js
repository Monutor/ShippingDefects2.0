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
  caches.keys().then((cacheNames) => {
    cacheNames.forEach((cacheName) => {
      caches.delete(cacheName)
    })
  })

  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
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
    window.showToast('⚠️ Нет подключения к сети')
    window.dispatchEvent(new CustomEvent('network-status', { detail: { online: false } }))
    isOffline = true
  } else if (!show && isOffline) {
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
  } catch (err) {
    console.error('[app] failed to flush offline separate deletes queue:', err)
  }
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

  // Все данные загружаются параллельно — один упавший load не ломает остальные
  const results = await Promise.allSettled([
    brainStore.loadFromBackend(),
    boxesStore.loadBoxes(),
    // loadActiveBox убран — MixView/PalletView загружают активные короба сами через loadAllActiveBoxes/loadAllActivePallets
    separateStore.loadSeparateItems(),
    palletStore.loadPallets()
  ])

  // FIX: логируем ошибки которые были скрыты в allSettled — показываем banner если критические загрузки провалились
  const criticalFailures = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      const names = ['brain', 'boxes', 'activeBox', 'separate', 'pallet']
      if (['brain', 'boxes'].includes(names[i])) {
        criticalFailures.push(names[i])
      }
    }
  }

  // Если критические загрузки провалились — показываем предупреждение пользователю
  if (criticalFailures.length > 0) {
    window.showToast(
      `⚠️ Не удалось загрузить: ${criticalFailures.join(', ')}. Данные будут загружены позже.`,
      10000,
      'warning'
    )
  }

  // Периодическая синхронизация активного короба (каждые 5 минут)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let syncIntervalId = null
  if (boxesStore.currentBox && uuidRegex.test(boxesStore.currentBox.id)) {
    syncIntervalId = setInterval(() => {
      if (navigator.onLine) boxesStore.loadBoxes()
    }, 300000) // каждые 5 минут
  }

  // Очистка интервала при logout (храним глобально для доступа из App.vue)
  window._appCleanup = {
    syncInterval: () => {
      if (syncIntervalId) clearInterval(syncIntervalId)
    }
  }
}

app.use(pinia)
app.use(router)

// Восстановить collector profile из auth session ДО монтирования — предотвращает гонку состояний
try {
  const { useCollectorStore } = await import('@/stores/collector')
  const collectorStore = useCollectorStore()
  collectorStore.restoreFromAuthSession()
} catch (err) {
  console.error('[app] failed to restore collector profile from auth session:', err)
}

// GitHub Pages SPA redirect handling
const redirectPath = sessionStorage.getItem('redirect_path')
if (redirectPath) {
  sessionStorage.removeItem('redirect_path')
  // Remove base path prefix if present
  const basePath = '/ShippingDefects2.0'
  const path = redirectPath.startsWith(basePath)
    ? redirectPath.slice(basePath.length)
    : redirectPath
  router.replace(path || '/')
}

// Запускаем инициализацию после монтирования, если не на /login
router.isReady().then(() => {
  if (router.currentRoute.value.path !== '/login') {
    initializeApp()
  }
})

app.mount('#app')
