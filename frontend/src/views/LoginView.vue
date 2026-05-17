<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { auth, db } from '@/lib/api.js'
import { useCollectorStore } from '@/stores/collector'
import { Input, Button, NavBar } from '@/components/ui'

const router = useRouter()
const collectorStore = useCollectorStore()

// Состояние формы
const step = ref('login') // 'login' | 'register'
const employeeId = ref('')
const fullName = ref('')
const position = ref('')
const isLoading = ref(false)
const error = ref(null)
onMounted(() => {
  // Если пользователь уже авторизован — переходим на главную
  if (auth.isAuthenticated()) {
    router.push('/')
    return
  }
})

async function handleLogin() {
  if (!employeeId.value.trim()) {
    error.value = 'Введите табельный номер'
    return
  }

  isLoading.value = true
  error.value = null

  try {
    const result = await auth.login(employeeId.value.trim())

    if (result.data) {
      // Профиль найден — авторизуем
      const profile = result.data.profile || {}
      
      // L1 fix: is_admin берём приоритетно из JWT payload, fallback на profile (consistency)
      const isAdmin = result.data.is_admin || profile.is_admin || false

      collectorStore.setCollectorData({
        employeeId: employeeId.value.trim(),
        fullName: profile.full_name,
        position: profile.position
      })

      // Сохраняем токен и данные в localStorage
      localStorage.setItem('warehouse-brain-user', JSON.stringify({
        employeeId: employeeId.value.trim(),
        fullName: profile.full_name,
        position: profile.position,
        is_admin: isAdmin,
        token: result.data.token,
        authenticatedAt: new Date().toISOString()
      }))

      window.dispatchEvent(new CustomEvent('auth-changed'))
      // BUG-9 fix: переподключаем WS после успешного логина (токен появился)
      const { ws } = await import('@/lib/api.js')
      ws.triggerReconnect()
      router.push('/')
    } else if (result.error?.code === 404) {
      // Профиль не найден — переходим к регистрации
      step.value = 'register'
      isLoading.value = false
    } else if (result.error?.code === 400 && result.error.message?.includes('fullName')) {
      // Пользователь не существует, но бэкенд требует fullName/position для регистрации
      step.value = 'register'
      isLoading.value = false
    }
  } catch (err) {
    error.value = `Ошибка соединения с сервером: ${err.message || 'Проверьте подключение к сети'}`
    isLoading.value = false
  }
}

async function handleRegister() {
  if (!employeeId.value.trim()) {
    error.value = 'Введите табельный номер'
    return
  }

  if (!fullName.value.trim()) {
    error.value = 'Введите ФИО'
    return
  }

  isLoading.value = true
  error.value = null

  try {
    const result = await auth.login(
      employeeId.value.trim(),
      fullName.value.trim(),
      position.value.trim() || 'Сборщик'
    )

    if (result.data) {
      collectorStore.setCollectorData({
        employeeId: employeeId.value.trim(),
        fullName: fullName.value.trim(),
        position: position.value.trim() || 'Сборщик'
      })

      const isAdmin = false // Новые пользователи всегда не-админы

      localStorage.setItem('warehouse-brain-user', JSON.stringify({
        employeeId: employeeId.value.trim(),
        fullName: fullName.value.trim(),
        position: position.value.trim() || 'Сборщик',
        is_admin: isAdmin,
        token: result.data.token,
        authenticatedAt: new Date().toISOString()
      }))

      window.dispatchEvent(new CustomEvent('auth-changed'))
      // BUG-9 fix: переподключаем WS после регистрации (токен появился)
      const { ws } = await import('@/lib/api.js')
      ws.triggerReconnect()
      router.push('/')
    } else {
      error.value = 'Регистрация не удалась'
    }
  } catch (err) {
    error.value = err.message || 'Ошибка регистрации'
  } finally {
    isLoading.value = false
  }
}

function goBack() {
  step.value = 'login'
  error.value = null
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col">
    <!-- Nav Bar -->
    <NavBar
      :title="step === 'login' ? 'Вход' : 'Регистрация'"
      left-text="Назад"
      left-arrow
      @click-left="goBack"
    />

    <!-- Error message -->
    <div v-if="error" class="mx-4 mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
      <p class="text-sm text-red-200">{{ error }}</p>
    </div>

    <!-- Login step -->
    <div v-if="step === 'login'" class="flex-1 flex items-center justify-center p-4">
      <div class="w-full max-w-md space-y-4">
        <div class="text-center mb-8">
          <h2 class="text-2xl font-bold text-slate-100 mb-2">Учёт брака</h2>
          <p class="text-slate-400">Введите ваш табельный номер</p>
        </div>

        <Input
          v-model="employeeId"
          label="Табельный номер"
          placeholder="Введите номер"
          type="text"
          autocomplete="off"
        />

        <Button
          block
          class="custom-btn-primary"
          :loading="isLoading"
          @click="handleLogin"
        >
          Войти
        </Button>
      </div>
    </div>

    <!-- Register step -->
    <div v-if="step === 'register'" class="flex-1 flex items-center justify-center p-4">
      <div class="w-full max-w-md space-y-4">
        <div class="text-center mb-8">
          <h2 class="text-2xl font-bold text-slate-100 mb-2">Регистрация</h2>
          <p class="text-slate-400">Заполните ваши данные</p>
        </div>

        <Input
          v-model="employeeId"
          label="Табельный номер"
          placeholder="Введите номер"
          type="text"
          autocomplete="off"
        />

        <Input
          v-model="fullName"
          label="ФИО"
          placeholder="Иванов Иван Иванович"
          type="text"
        />

        <Input
          v-model="position"
          label="Должность"
          placeholder="Кладовщик"
          type="text"
        />

        <Button
          block
          class="custom-btn-primary"
          :loading="isLoading"
          @click="handleRegister"
        >
          Зарегистрироваться
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-btn-primary {
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  border: none;
}

.custom-btn-primary:active {
  opacity: 0.9;
}
</style>
