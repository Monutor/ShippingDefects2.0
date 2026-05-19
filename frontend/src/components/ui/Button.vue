<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'secondary', 'success', 'warning', 'danger', 'ghost'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  disabled: Boolean,
  loading: Boolean,
  block: Boolean,
  icon: String,
  ariaLabel: {
    type: String,
    default: ''
  }
})

defineEmits(['click'])

const variantClasses = {
  primary: 'bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-500/30',
  secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-100',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/30',
  warning: 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/30',
  danger: 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-500/30',
  ghost: 'bg-transparent hover:bg-slate-700 text-slate-100 border border-slate-600'
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-base',
  lg: 'px-6 py-3.5 text-lg'
}
</script>

<template>
  <button
    :aria-label="ariaLabel || undefined"
    :class="[
      'relative inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-slate-900',
      variantClasses[variant],
      sizeClasses[size],
      block ? 'w-full' : '',
      disabled || loading ? 'opacity-50 cursor-not-allowed' : ''
    ]"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="absolute">
      <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="4"
          fill="none"
        />
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </span>
    <span :class="{ 'opacity-0': loading }" class="flex flex-col items-center justify-center gap-1">
      <van-icon
        v-if="icon"
        :name="icon"
        :size="size === 'sm' ? 16 : size === 'lg' ? 22 : 18"
        class="shrink-0"
      />
      <slot />
    </span>
  </button>
</template>

<style scoped>
/* Иконка всегда наследует цвет кнопки */
:deep(.van-icon) {
  color: currentColor;
}
</style>
