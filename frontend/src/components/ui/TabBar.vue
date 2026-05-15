<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const activeIndex = computed(() => {
  const routeMap = {
    '/': 0,
    '/upload': 1,
    '/mix-view': 2,
    '/pallet-view': 3,
    '/separate': 4,
    '/boxes': 5,
    '/user': 6
  }
  return routeMap[route.path] ?? 0
})

const items = [
  { icon: `${import.meta.env.BASE_URL}img/navIcons/home-icon.svg`, text: 'Главная', path: '/' },
  { icon: `${import.meta.env.BASE_URL}img/navIcons/database-svg.svg`, text: 'База данных', path: '/upload' },
  { icon: `${import.meta.env.BASE_URL}img/navIcons/box-svg.svg`, text: 'Миксы', path: '/mix-view' },
  { icon: `${import.meta.env.BASE_URL}img/navIcons/box-svg.svg`, text: 'Паллеты', path: '/pallet-view' },
  { icon: `${import.meta.env.BASE_URL}img/navIcons/truck-svg.svg`, text: 'Отдельные', path: '/separate' },
  { icon: `${import.meta.env.BASE_URL}img/navIcons/box-svg.svg`, text: 'Результаты', path: '/boxes' },
  { icon: `${import.meta.env.BASE_URL}img/navIcons/profile-icon.svg`, text: 'Профиль', path: '/user' }
]

function handleItemClick(index, path) {
  router.push(path)
}
</script>

<template>
  <nav class="fixed bottom-1 left-0 right-0 z-50 px-3 pb-6 safe-area-bottom">
    <div class="tabbar-container">
      <div class="tabbar-content">
        <button
          v-for="(item, index) in items"
          :key="item.path"
          :class="[
            'tabbar-item flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all duration-200',
            activeIndex === index ? 'active' : ''
          ]"
          @click="handleItemClick(index, item.path)"
        >
          <!-- Кастомная SVG иконка -->
          <img
            :src="item.icon"
            :alt="item.text"
            :class="[
              'w-5 h-5 transition-colors duration-200',
              activeIndex === index ? 'icon-active' : ''
            ]"
          />
          <span class="text-xs">{{ item.text }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.tabbar-container {
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 24px;
  border: 1px solid rgba(51, 65, 85, 0.5);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.tabbar-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  column-gap: 10px;
  padding: 8px 10px;
  overflow-x: auto;
}

.tabbar-item {
  background: transparent !important;
  border: none !important;
  outline: none !important;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 64px;
}

.tabbar-item:active {
  transform: scale(0.95);
}

/* SVG иконки */
.tabbar-item img {
  transition: opacity 0.2s ease;
  opacity: 0.6;
}

/* Активная иконка */
.tabbar-item.active img {
  opacity: 1;
}

/* Текст */
.tabbar-item span {
  color: #64748b;
  font-size: 10px;
  font-weight: 500;
  transition: color 0.2s ease;
}

/* Активное состояние */
.tabbar-item.active span {
  color: #60a5fa;
}

/* Hover эффект для неактивных */
.tabbar-item:not(.active):hover img {
  opacity: 0.8;
}

.tabbar-item:not(.active):hover span {
  color: #94a3b8;
}
</style>
