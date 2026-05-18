import { createRouter, createWebHistory } from 'vue-router'
import { isAdmin } from '@/config'

// Глобальное состояние maintenance mode (синхронизируется через SSE в maintenance store)
let _maintenanceMode = false
let _maintenanceLoading = true

/** Вызов из maintenance store при получении SSE init/maintenance_mode_changed */
window.__setMaintenanceMode = function (enabled, loading = false) {
  _maintenanceMode = enabled
  _maintenanceLoading = loading
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue')
    },
    {
      path: '/upload',
      name: 'upload',
      component: () => import('@/views/UploadView.vue'),
      props: (route) => ({
        key: Date.now(), // Принудительная перерисовка при каждом заходе
        timestamp: Date.now()
      })
    },
    {
      path: '/mix-view',
      name: 'mix-view',
      component: () => import('@/views/MixView.vue')
    },
    {
      path: '/pallet-view',
      name: 'pallet-view',
      component: () => import('@/views/PalletView.vue')
    },
    {
      path: '/boxes',
      name: 'boxes',
      component: () => import('@/views/BoxesView.vue')
    },
    {
      path: '/pallet/:palletId?',
      name: 'pallet-detail',
      component: () => import('@/views/PalletDetailView.vue')
    },
    {
      path: '/mix/:boxId?',
      name: 'mix-detail',
      component: () => import('@/views/MixDetailView.vue')
    },
    {
      path: '/separate',
      name: 'separate',
      component: () => import('@/views/SeparateView.vue')
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue')
    },
    {
      path: '/user',
      name: 'user',
      component: () => import('@/views/UserView.vue')
    }
  ]
})

// Navigation guard для режима тех.работ — проверяет глобальное состояние (SSE)
router.beforeEach((to, from, next) => {
  // Пока loading — пропускаем все маршруты (данные ещё не загружены)
  if (_maintenanceLoading) return next()

  const isMaintenanceEnabled = _maintenanceMode
  if (!isMaintenanceEnabled) {
    return next()
  }

  // Админ всегда имеет доступ ко всем страницам
  if (isAdmin()) {
    return next()
  }

  // Обычных пользователей перенаправляем на заглушку (обрабатывается в App.vue)
  // Разрешаем только переход на login для админа
  if (to.path === '/login') {
    return next()
  }

  // Все остальные запросы перенаправляем на главную (где покажется заглушка)
  return next('/')
})

export default router
