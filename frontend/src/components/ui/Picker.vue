<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: String,
  columns: Array,
  title: String,
  confirmText: { type: String, default: 'OK' },
  cancelText: { type: String, default: 'Отмена' }
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel'])

const isOpen = ref(false)
const selectedValue = ref(props.modelValue)

function open() {
  selectedValue.value = props.modelValue
  isOpen.value = true
}

function close() {
  isOpen.value = false
  emit('cancel')
}

function handleConfirm() {
  emit('update:modelValue', selectedValue.value)
  emit('confirm', selectedValue.value)
  isOpen.value = false
}

const selectedText = computed(() => {
  const col = props.columns?.find((c) => c.value === props.modelValue)
  return col?.text || 'Выберите значение'
})

defineExpose({ open })
</script>

<template>
  <div>
    <!-- Trigger -->
    <div
      v-if="!isOpen"
      class="flex items-center justify-between p-4 border-b border-slate-700 cursor-pointer hover:bg-slate-700/50 transition-colors"
      @click="open"
    >
      <span class="text-sm text-slate-400">{{ title }}</span>
      <div class="flex items-center gap-2">
        <span class="text-slate-100">{{ selectedText }}</span>
        <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>

    <!-- Picker Modal -->
    <Teleport to="body">
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isOpen"
          class="fixed inset-0 z-[100] flex items-end bg-black/70 backdrop-blur-sm"
          @click="close"
        >
          <transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="transform translate-y-full"
            enter-to-class="transform translate-y-0"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="transform translate-y-0"
            leave-to-class="transform translate-y-full"
          >
            <div
              v-if="isOpen"
              class="picker-container bg-slate-900 rounded-t-3xl w-full overflow-hidden border-t border-slate-700 shadow-2xl"
              @click.stop
            >
              <!-- Header -->
              <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                <button
                  class="text-slate-200 text-base hover:text-slate-200 transition-colors border-none rounded-lg px-3 py-1 bg-slate-800/50 hover:bg-slate-800/70 cursor-pointer"
                  @click="close"
                >
                  {{ cancelText }}
                </button>
                <h3 class="text-slate-100 font-semibold text-base">
                  {{ title }}
                </h3>
                <button
                  class="text-primary-400 text-base hover:text-primary-300 transition-colors border-none rounded-lg px-3 py-1 bg-slate-800/50 hover:bg-slate-800/70 ursor-pointer"
                  @click="handleConfirm"
                >
                  {{ confirmText }}
                </button>
              </div>

              <!-- Options -->
              <div class="max-h-72 overflow-y-auto scrollbar-thin">
                <button
                  v-for="col in columns"
                  :key="col.value"
                  :class="[
                    'w-full px-4 py-4 text-left transition-all duration-200 border-b border-slate-800 bg-slate-800 last:border-b-0',
                    selectedValue === col.value
                      ? 'bg-primary-500/10 text-primary-400'
                      : 'text-slate-300 hover:bg-slate-800/50 hover:text-slate-100'
                  ]"
                  @click="selectedValue = col.value"
                >
                  <span class="text-base">{{ col.text }}</span>
                </button>
              </div>
            </div>
          </transition>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.picker-container {
  background: #0f172a;
}

/* Скроллбар */
.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: #1e293b;
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: #475569;
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: #64748b;
}
</style>
