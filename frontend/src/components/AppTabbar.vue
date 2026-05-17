<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

// Активный элемент таббара
const activeTab = computed(() => {
  const routeMap = {
    '/': 0,
    '/upload': 1,
    '/boxes': 2,
    '/separate': 3,
    '/user': 4
  }
  return routeMap[route.path] ?? 0
})

// Показывать ли таббар на текущей странице
const showTabbar = computed(() => {
  return true
})
</script>

<template>
  <TabBar v-if="showTabbar" :model-value="activeTab" />
</template>
