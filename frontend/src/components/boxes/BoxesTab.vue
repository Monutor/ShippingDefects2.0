<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBoxesStore } from '@/stores/boxes'
import { SwipeCard, Button, Loader } from '@/components/ui'

const props = defineProps({
  boxes: { type: Array, required: true },
  isLoading: { type: Boolean, default: false }
})

const emit = defineEmits(['request-delete', 'load-items', 'export-all'])

const router = useRouter()
const boxesStore = useBoxesStore()

const boxesReverse = computed(() => [...props.boxes].reverse())

function formatDate(dateString) {
  return new Date(dateString).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <div class="p-4">
    <Loader v-if="isLoading" text="Загрузка коробов..." />

    <div v-else-if="boxes.length === 0" class="empty-state py-16">
      <div
        class="w-24 h-24 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-6 border-2 border-amber-500/30"
      >
        <span class="text-5xl">📦</span>
      </div>
      <h3 class="text-lg font-semibold text-slate-100 mb-2">Пока нет миксов</h3>
      <p class="text-slate-400 text-sm mb-6">
        Начните сканирование для создания первого короба
      </p>
      <Button @click="$router.push('/mix-view')">Начать сканирование</Button>
    </div>

    <div v-else class="boxes-list py-4">
      <SwipeCard
        v-for="(box, index) in boxesReverse"
        :key="box.id"
        @delete="$emit('request-delete', boxes.length - 1 - index, box)"
      >
        <div class="box-card p-4 cursor-pointer" @click="router.push(`/mix/${box.id}`)">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-lg text-slate-100 mb-1">{{ box.name }}</h3>
              <p class="text-sm text-slate-400">
                <template v-if="box.itemsLoaded">
                  <span class="font-medium text-amber-400">{{ box.items.length }}</span>
                  товаров <span class="mx-2 text-slate-600">•</span>
                  {{ formatDate(box.createdAt) }} завершён
                </template>
                <template v-else>
                  нажмите чтобы посмотреть
                  <span class="mx-2 text-slate-600">•</span>
                  {{ formatDate(box.createdAt) }} завершён
                </template>
              </p>
            </div>
            <span class="text-slate-500 flex-shrink-0 self-center">
              <van-icon name="arrow" size="20" aria-hidden="true" />
            </span>
          </div>
        </div>
      </SwipeCard>
      <Button block class="mt-4 custom-btn-primary" @click="$emit('export-all')">
        <van-icon name="down" class="mr-2" aria-hidden="true" /> Экспортировать все короба ({{ boxes.length }})
      </Button>
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.box-card {
  background: rgba(30, 41, 59, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1rem;
  transition: all 0.2s ease;
}
.box-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(30, 41, 59, 0.95);
}
.custom-btn-primary {
  background: linear-gradient(to right, #3b82f6, #2563eb) !important;
  border: none !important;
  color: #ffffff !important;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4) !important;
}
.custom-btn-primary:hover {
  background: linear-gradient(to right, #2563eb, #1d4ed8) !important;
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.5) !important;
}
</style>
