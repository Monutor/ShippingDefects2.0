import { createApp } from 'vue'
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
// Локальная инициализация: автозагрузка всех данных при старте
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
    separateStore.loadSeparateItems(),
    palletStore.loadPallets()
  ])

  // FIX: логируем ошибки которые были скрыты в allSettled — показываем banner если критические загрузки провались
  const criticalFailures = []
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      const names = ['brain', 'boxes', 'activeBox', 'separate', 'pallet']
      if (['brain', 'boxes'].includes(names[i])) {
        criticalFailures.push(names[i])
      }
    }
  }

  // Если критические загрузки провались — показываем предупреждение пользователю
  if (criticalFailures.length > 0) {
    window.showToast(
      `⚠️ Не удалось загрузить: ${criticalFailures.join(', ')}. Данные будут загружены позже.`,
      10000,
      'warning'
    )
  }

  window._appCleanup = {}
}

app.use(pinia)
app.use(router)

// Миграция IndexedDB на актуальную схему ДО любых чтений/записей
try {
  const { ensureDbReady } = await import('@/lib/db')
  await ensureDbReady()
} catch (err) {
  console.error('[app] failed to prepare database:', err)
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

// Запускаем инициализацию после монтирования
router.isReady().then(() => {
  initializeApp()
})

app.mount('#app')
