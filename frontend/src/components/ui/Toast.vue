<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)
const message = ref('')
const type = ref('default') // default, success, warning, error
const timer = ref(null)

function showToast(text, duration = 2500, toastType = 'default') {
  message.value = text
  type.value = toastType
  visible.value = true

  if (timer.value) clearTimeout(timer.value)
  // Ошибки показываем дольше — пользователь должен успеть прочитать
  const showDuration = toastType === 'error' ? 4000 : duration
  timer.value = setTimeout(() => {
    visible.value = false
  }, showDuration)
}

// Экспортируем функцию глобально
onMounted(() => {
  window.showToast = showToast
})

onUnmounted(() => {
  if (timer.value) clearTimeout(timer.value)
})
</script>

<template>
  <Teleport to="body">
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-95 translate-y-[-10px]"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="visible"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
      >
        <!-- Default -->
        <div
          v-if="type === 'default'"
          class="bg-slate-800/95 backdrop-blur-md border border-slate-700 rounded-2xl px-6 py-4 shadow-2xl"
        >
          <p class="text-slate-100 text-sm font-medium whitespace-nowrap">{{ message }}</p>
        </div>

        <!-- Success -->
        <div
          v-else-if="type === 'success'"
          class="bg-emerald-900/95 backdrop-blur-md border border-emerald-600 rounded-2xl px-6 py-4 shadow-2xl shadow-emerald-500/10"
        >
          <p class="text-emerald-100 text-sm font-medium whitespace-nowrap">{{ message }}</p>
        </div>

        <!-- Warning -->
        <div
          v-else-if="type === 'warning'"
          class="bg-amber-900/95 backdrop-blur-md border border-amber-600 rounded-2xl px-6 py-4 shadow-2xl shadow-amber-500/10"
        >
          <p class="text-amber-100 text-sm font-medium whitespace-nowrap">{{ message }}</p>
        </div>

        <!-- Error — чужой контейнер -->
        <div
          v-else-if="type === 'error'"
          class="bg-red-900/95 backdrop-blur-md border border-red-600 rounded-2xl px-6 py-4 shadow-2xl shadow-red-500/15"
        >
          <p class="text-red-100 text-sm font-medium whitespace-nowrap">{{ message }}</p>
        </div>
      </div>
    </transition>
  </Teleport>
</template>
