<script setup>
defineProps({
  text: {
    type: String,
    default: 'Загрузка...'
  },
  size: {
    type: String,
    default: 'md', // sm, md, lg
    validator: (value) => ['sm', 'md', 'lg'].includes(value)
  }
})

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16'
}
</script>

<template>
  <div class="loader-container">
    <div class="loader-content">
      <div :class="['loader-spinner', sizeClasses[size]]">
        <svg viewBox="0 0 50 50" class="spinner">
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke-width="4"
            stroke-linecap="round"
            class="spinner-track"
          />
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke-width="4"
            stroke-linecap="round"
            class="spinner-indicator"
          />
        </svg>
      </div>
      <p v-if="text" class="loader-text">{{ text }}</p>
    </div>
  </div>
</template>

<style scoped>
.loader-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  width: 100%;
}

.loader-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.loader-spinner {
  position: relative;
  animation: rotate 1.4s linear infinite;
}

.spinner {
  width: 100%;
  height: 100%;
}

.spinner-track {
  stroke: rgba(148, 163, 184, 0.2);
}

.spinner-indicator {
  stroke: #60a5fa;
  stroke-dasharray: 125;
  stroke-dashoffset: 100;
  transform-origin: center;
  animation: dash 1.4s ease-in-out infinite;
}

.loader-text {
  color: #94a3b8;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: center;
}

@keyframes rotate {
  100% {
    transform: rotate(360deg);
  }
}

@keyframes dash {
  0% {
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 100, 200;
    stroke-dashoffset: -15;
  }
  100% {
    stroke-dasharray: 100, 200;
    stroke-dashoffset: -125;
  }
}
</style>
