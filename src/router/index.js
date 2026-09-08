import { createRouter, createWebHistory } from 'vue-router'

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
      props: () => ({
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
    }
  ]
})

export default router
