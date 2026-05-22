<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { SwipeCard, Button, Loader } from '@/components/ui'

const props = defineProps({
  pallets: { type: Array, required: true },
  availableBoxes: { type: Array, required: true },
  isLoading: { type: Boolean, default: false },
  isOwner: { type: Function, required: true }
})

const emit = defineEmits(['load-box-items', 'export-all'])

const router = useRouter()
const palletsReverse = computed(() => [...props.pallets].reverse())

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
    <Loader v-if="isLoading" text="Загрузка паллетов..." />

    <div v-else-if="pallets.length === 0" class="empty-state py-8">
      <div
        class="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6 border-2 border-blue-500/30"
      >
        <span class="text-5xl">🏗️</span>
      </div>
      <h3 class="text-lg font-semibold text-slate-100 mb-2">Сборка паллета</h3>

      <div v-if="availableBoxes.length > 0" class="space-y-3 px-4 max-w-md mx-auto">
        <p class="text-slate-400 text-sm mb-3">
          Доступно готовых коробов: {{ availableBoxes.length }}
        </p>
        <div
          class="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-700/50 max-h-64 overflow-y-auto scrollbar-thin"
        >
          <div
            v-for="box in availableBoxes"
            :key="box.id"
            class="p-3 flex items-center gap-3 hover:bg-slate-700/30 transition-colors cursor-pointer"
            @click="$emit('load-box-items', box)"
          >
            <div
              class="w-10 h-10 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center flex-shrink-0"
            >
              <span class="text-sm font-bold text-primary-400">📦</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-100 truncate">{{ box.name }}</p>
              <p v-if="box.itemsLoaded" class="text-xs text-slate-400">
                {{ box.collector_id || 'Неизвестный' }} · {{ box.itemCount }} тов.
              </p>
              <p v-else class="text-xs italic text-slate-500">нажмите для загрузки</p>
            </div>
          </div>
        </div>
        <Button block class="mt-3 custom-btn-primary" @click="router.push('/pallet-view')">
          <van-icon name="add-o" class="mr-2" aria-hidden="true" /> Создать паллет ({{
            availableBoxes.length
          }}
          коробов доступно)
        </Button>
      </div>

      <div v-else class="px-4">
        <p class="text-slate-400 text-sm mb-2">Нет готовых коробов для сборки паллета</p>
        <p class="text-xs text-slate-500">Сначала завершите короб(а) в разделе «Миксы»</p>
      </div>
    </div>

    <div v-else class="boxes-list py-4">
      <SwipeCard v-for="pallet in palletsReverse" :key="pallet.id">
        <div class="box-card p-4 cursor-pointer" @click="router.push(`/pallet/${pallet.id}`)">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs text-slate-500 mb-1">👤 {{ pallet.collector_id || 'Неизвестный' }}</p>
            <span
              v-if="!isOwner(pallet.collector_id)"
              class="px-2 py-0.5 bg-red-500/20 border border-red-500/30 rounded-full text-xs font-semibold text-red-400"
            >
              ЧУЖОЙ
            </span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-lg text-slate-100 mb-1">{{ pallet.name }}</h3>
              <p class="text-sm text-slate-400">
                📦{{
                  pallet.boxCount != null
                    ? pallet.boxCount
                    : (pallet.items || []).filter((i) => i.source_type === 'box').length
                }}
                · 📋{{
                  (pallet.separateItemCount != null
                    ? pallet.separateItemCount
                    : (pallet.items || []).filter((i) => i.source_type === 'separate_item')
                        .length) + (pallet.inlineCount || 0)
                }}
                товаров
                <span class="mx-2 text-slate-600">•</span>
                {{ formatDate(pallet.finishedAt || '') }} завершён
              </p>
            </div>
            <span class="text-slate-500 flex-shrink-0 self-center">
              <van-icon name="arrow" size="20" aria-hidden="true" />
            </span>
          </div>
        </div>
      </SwipeCard>
      <Button block class="mt-4 custom-btn-primary" @click="$emit('export-all')">
        <van-icon name="down" class="mr-2" aria-hidden="true" /> Экспортировать все паллеты ({{
          pallets.length
        }})
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
