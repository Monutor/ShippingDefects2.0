<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: String,
  type: { type: String, default: 'text' },
  placeholder: String,
  label: String,
  disabled: Boolean,
  readonly: Boolean,
  clearable: Boolean,
  icon: [Boolean, String]  // Поддерживаем и boolean, и строку (название иконки)
})

const emit = defineEmits(['update:modelValue', 'keyup', 'change', 'blur', 'click'])

const inputValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const showClear = computed(() => {
  return props.clearable && inputValue.value && !props.disabled
})

function handleClear() {
  emit('update:modelValue', '')
}

const inputRef = ref(null)
</script>

<template>
  <div class="w-full">
    <label v-if="label" class="block text-sm font-medium text-slate-400 mb-2">
      {{ label }}
    </label>
    <div class="relative">
      <img
        v-if="icon"
        src="/img/scan-svg.svg"
        alt="scan"
        class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none opacity-60"
      />
      <input
        ref="inputRef"
        v-model="inputValue"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :class="[
          'w-full bg-slate-800 border border-slate-600 rounded-xl',
          'text-slate-100 placeholder-slate-500',
          'px-4 py-3',
          icon ? 'pl-11' : '',
          clearable ? 'pr-11' : '',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-all duration-200'
        ]"
        @keyup="$emit('keyup', $event)"
        @change="$emit('change', $event)"
        @blur="$emit('blur', $event)"
        @click="$emit('click', $event)"
      />
      <svg
        v-if="showClear"
        class="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 cursor-pointer hover:text-slate-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        @click="handleClear"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  </div>
</template>
