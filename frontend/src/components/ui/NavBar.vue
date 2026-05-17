<script setup>
defineProps({
  title: String,
  leftText: String,
  leftArrow: Boolean,
  rightText: String
})

defineEmits(['click-left', 'click-right'])
</script>

<template>
  <nav class="nav-bar sticky top-0 z-40 px-2 py-3 mb-4">
    <div class="nav-bar-content">
      <!-- Left -->
      <div class="nav-bar-left">
        <button
          v-if="leftArrow || leftText"
          class="nav-bar-button"
          @click="$emit('click-left')"
        >
          <van-icon v-if="leftArrow" name="arrow-left" size="16" />
          <span v-if="leftText" class="nav-bar-button-text">{{ leftText }}</span>
        </button>
      </div>

      <!-- Title -->
      <h1 class="nav-bar-title">
        {{ title }}
      </h1>

      <!-- Right -->
      <div class="nav-bar-right">
        <button
          v-if="rightText"
          class="nav-bar-button-text"
          @click="$emit('click-right')"
        >
          {{ rightText }}
        </button>
        <slot name="right" />
      </div>
    </div>
  </nav>
</template>

<style scoped>
.nav-bar {
  background: rgba(30, 41, 59, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(51, 65, 85, 0.5);
}

.nav-bar-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
}

.nav-bar-left,
.nav-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 80px;
}

.nav-bar-left {
  justify-content: flex-start;
}

.nav-bar-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 16px;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
}

.nav-bar-button {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.nav-bar-button:hover {
  background: rgba(255, 255, 255, 0.05) !important;
}

.nav-bar-button:active {
  transform: scale(0.95);
}

.nav-bar-button-text {
  background: transparent !important;
  border: none !important;
  outline: none !important;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #94a3b8;
  padding: 4px 8px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.nav-bar-button-text:hover {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.05) !important;
}

/* Переопределение стилей Vant для иконок */
.nav-bar-button :deep(.van-icon) {
  color: #94a3b8;
  transition: color 0.2s ease;
}

.nav-bar-button:hover :deep(.van-icon) {
  color: #f1f5f9;
}
</style>
