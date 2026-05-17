<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: Number
})

const emit = defineEmits(['update:modelValue'])

const activeTab = computed({
  get: () => props.modelValue ?? 0,
  set: (val) => emit('update:modelValue', val)
})

// Массив title ref — каждый обновляется реактивно своим Tab
const tabTitles = ref([])

/** Вызывается каждым Tab при монтировании */
function registerTab(index, initialTitle) {
  const titleRef = ref(typeof initialTitle === 'function' ? initialTitle() : String(initialTitle))
  
  if (index >= tabTitles.value.length) {
    while (tabTitles.value.length <= index) {
      tabTitles.value.push(null)
    }
    tabTitles.value = [...tabTitles.value, titleRef]
  } else {
    const updated = [...tabTitles.value]
    updated[index] = titleRef
    tabTitles.value = updated
  }
  
  return {
    set(title) {
      titleRef.value = typeof title === 'function' ? title() : String(title)
    }
  }
}

defineExpose({ registerTab })
</script>

<template>
  <div class="w-full mt-2">
    <!-- Tab Headers -->
    <div class="flex items-center bg-slate-800/80 backdrop-blur-sm border-b border-slate-700 rounded-t-2xl">
      <button
        v-for="(title, index) in tabTitles"
        :key="index"
        :class="[
          'flex-1 py-3.5 text-sm font-semibold transition-all duration-200',
          activeTab === index
            ? 'text-slate-100 border-b-2 border-primary-500'
            : 'text-slate-500 hover:text-slate-300'
        ]"
        @click="activeTab = index"
      >
        {{ title?.value ?? '' }}
      </button>
    </div>

    <!-- Tab Content -->
    <div class="bg-slate-800/50 backdrop-blur-sm border-x border-b border-slate-700 rounded-b-2xl">
      <slot />
    </div>
  </div>
</template>
