<script setup>
import { ref } from 'vue'

defineProps({
  rightWidth: { type: Number, default: 80 }
})

const emit = defineEmits(['delete'])

const translateX = ref(0)
const isSwiped = ref(false)
const startX = ref(0)

function handleTouchStart(e) {
  startX.value = e.touches[0].clientX
}

function handleTouchMove(e) {
  const diff = startX.value - e.touches[0].clientX
  if (diff > 0) {
    translateX.value = Math.min(diff, 80)
  }
}

function handleTouchEnd() {
  if (translateX.value > 40) {
    translateX.value = 80
    isSwiped.value = true
  } else {
    translateX.value = 0
    isSwiped.value = false
  }
}

function close() {
  translateX.value = 0
  isSwiped.value = false
}

function handleDelete() {
  emit('delete')
  close()
}
</script>

<template>
  <div class="relative overflow-hidden rounded-2xl mb-3">
    <!-- Background action -->
    <div
      class="absolute right-0 top-0 bottom-0 w-20 bg-rose-600 flex items-center justify-center rounded-r-2xl"
    >
      <button
        class="w-full h-full flex items-center justify-center text-white"
        @click="handleDelete"
      >
        <van-icon name="delete-o" size="20" />
      </button>
    </div>

    <!-- Content -->
    <div
      :class="[
        'relative bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-2xl transition-transform duration-200',
        'touch-pan-y'
      ]"
      :style="{ transform: `translateX(-${translateX}px)` }"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <slot />
    </div>
  </div>
</template>
