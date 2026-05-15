<script setup>
import { ref } from 'vue'

const props = defineProps({
  accept: { type: String, default: '.xlsx,.xls' },
  loading: Boolean
})

const emit = defineEmits(['change'])

const fileInput = ref(null)

function handleClick() {
  console.log('[FileUpload] Клик по зоне загрузки')
  fileInput.value?.click()
}

function handleChange(e) {
  console.log('[FileUpload] Событие change', e)
  const file = e.target?.files?.[0]
  console.log('[FileUpload] Выбранный файл:', file)
  console.log('[FileUpload] Эмит события change с файлом')
  emit('change', file)
  console.log('[FileUpload] Событие эмитнуто')
}
</script>

<template>
  <div>
    <input
      ref="fileInput"
      type="file"
      :accept="accept"
      class="hidden"
      @change="handleChange"
    />
    <div
      :class="[
        'flex flex-col items-center justify-center h-48 rounded-3xl cursor-pointer transition-all duration-200',
        'bg-slate-800/80 backdrop-blur-sm border-2 border-dashed',
        loading ? 'border-primary-500 opacity-50' : 'border-slate-600 hover:border-primary-500'
      ]"
      @click="handleClick"
    >
      <slot>
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mb-4 shadow-lg shadow-primary-500/30">
          <svg v-if="!loading" class="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <svg v-else class="animate-spin h-8 w-8 text-white" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <p class="text-slate-100 font-semibold text-center px-4">
          {{ loading ? 'Загрузка...' : 'Нажмите для выбора файла' }}
        </p>
        <span class="text-slate-400 text-sm mt-2">Поддерживаются форматы .xlsx и .xls</span>
      </slot>
    </div>
  </div>
</template>
