<script setup>
import { inject, computed, watchEffect } from 'vue'

const props = defineProps({
  title: [String, Number],
  index: Number
})

const tabIndex = computed(() => props.index ?? 0)
const registerTab = inject('registerTab', null)

// Регистрируем заголово у родителя и следим за изменениями
if (registerTab) {
  const registration = registerTab(tabIndex.value, () => String(props.title))
  
  // При изменении props.title — обновляем заголово в родителе
  watchEffect(() => {
    if (props.title !== undefined && registration?.set) {
      registration.set(String(props.title))
    }
  })
}

const activeTab = inject('activeTab', computed(() => 0))
const isActive = computed(() => activeTab.value === tabIndex.value)
</script>

<template>
  <div v-if="isActive" class="tab-panel">
    <slot />
  </div>
</template>
