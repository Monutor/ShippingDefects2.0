<script setup>
import { RouterView, useRoute } from 'vue-router'
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useMaintenanceStore } from '@/stores/maintenance'
import { isAdmin } from '@/config'
import AppTabbar from '@/components/AppTabbar.vue'
import Toast from '@/components/ui/Toast.vue'
import MaintenanceMode from '@/components/MaintenanceMode.vue'

const route = useRoute()
const maintenanceStore = useMaintenanceStore()

// Проверка авторизации
const isAuthenticated = ref(false)
const isUserAdmin = ref(false)
const isOffline = ref(false)
const isLoginPage = computed(() => route.path === '/login')

function checkAuth() {
  const userData = localStorage.getItem('warehouse-brain-user')
  isAuthenticated.value = !!userData
  isUserAdmin.value = isAdmin()
}

function updateAdminStatus() {
  isUserAdmin.value = isAdmin()
}

let _sseSubscribed = false

onMounted(async () => {
  checkAuth()

  // Не загружаем данные и не подписываемся на SSE если на /login
  if (route.path === '/login') return

  await maintenanceStore.loadFromBackend()
  if (!_sseSubscribed) {
    maintenanceStore.subscribeToChanges()
    _sseSubscribed = true
  }

  // Слушаем события network status из main.js
  window.addEventListener('network-status', (e) => {
    isOffline.value = !e.detail.online
  })
})

onUnmounted(() => {
  maintenanceStore.unsubscribeFromChanges()
})
</script>

<template>
  <div id="app">
    <!-- Offline banner -->
    <div
      v-if="isOffline"
      class="offline-banner fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-white text-center py-2 text-sm font-medium shadow-lg"
    >
      ⚠️ Нет подключения к сети — данные сохраняются локально
    </div>

    <!-- Режим тех.работ -->
    <MaintenanceMode v-if="maintenanceStore.isEnabled && !isUserAdmin && !isLoginPage" />

    <!-- Обычный режим или админ видит приложение, или страница логина -->
    <template v-else>
      <RouterView />
      <AppTabbar />
    </template>

    <Toast />
  </div>
</template>

<style>
#app {
  width: 100%;
  height: auto !important;
}
</style>
