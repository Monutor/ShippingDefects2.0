<script setup>
import { computed } from 'vue'

defineOptions({
  inheritAttrs: false
})

const props = defineProps({
  modelValue: Boolean,
  title: String,
  showCancel: Boolean,
  confirmText: { type: String, default: 'OK' },
  cancelText: { type: String, default: 'Отмена' },
  confirmColor: { type: String, default: 'primary' }
})

const emit = defineEmits(['update:modelValue', 'confirm', 'cancel', 'closed'])

const isVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

function handleConfirm() {
  emit('confirm')
  isVisible.value = false
}

function handleCancel() {
  emit('cancel')
  isVisible.value = false
}

function handleOverlayClick() {
  isVisible.value = false
  emit('closed')
}
</script>

<template>
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
        v-if="isVisible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        @click="handleOverlayClick"
      >
        <div
          class="bg-slate-900 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-700"
          @click.stop
        >
          <!-- Header -->
          <div v-if="title" class="px-6 pt-6 pb-3">
            <h3 class="text-lg font-semibold text-slate-100 text-center">{{ title }}</h3>
          </div>

          <!-- Content -->
          <div class="px-6 py-4">
            <slot />
          </div>

          <!-- Actions -->
          <div v-if="showCancel" class="flex items-stretch border-t border-slate-700">
            <button
              class="flex-1 py-4 text-white font-semibold bg-slate-800 hover:bg-slate-700 transition-colors first:rounded-bl-3xl"
              @click="handleCancel"
            >
              {{ cancelText }}
            </button>
            <button
              class="flex-1 py-4 font-semibold transition-colors last:rounded-br-3xl"
              :class="
                confirmColor === 'danger'
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-primary-600 hover:bg-primary-500 text-white'
              "
              @click="handleConfirm"
            >
              {{ confirmText }}
            </button>
          </div>
          <div v-else class="border-t border-slate-700">
            <button
              class="w-full py-4 bg-primary-600 hover:bg-primary-500 text-white font-semibold transition-colors rounded-b-3xl"
              @click="handleConfirm"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>
