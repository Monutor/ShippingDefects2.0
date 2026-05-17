<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { auth, db, request } from '@/lib/api.js'
import Button from '@/components/ui/Button.vue'
import NavBar from '@/components/ui/NavBar.vue'

const router = useRouter()
const route = useRoute()

// Состояние
const pallet = ref(null)
const palletItems = ref([])
const isLoading = ref(true)
const error = ref(null)

// Текущий пользователь и проверка владения
const currentUserId = computed(() => auth.getUserId() || '')
function isOwner(collectorId) {
  return currentUserId.value && collectorId === currentUserId.value
}

// Загрузка данных паллета
async function loadPallet(palletId) {
  isLoading.value = true
  error.value = null
  palletItems.value = []

  try {
    const palletResult = await request(`/api/pallets/${palletId}`)
    if (palletResult?.error || !palletResult?.data) {
      error.value = 'Паллет не найден'
      pallet.value = null
      return
    }

    pallet.value = palletResult.data

    // Загружаем товары паллета
    const itemsResult = await db.palletItems.getByPalletId(palletId)
    if (itemsResult?.data && Array.isArray(itemsResult.data)) {
      for (const item of itemsResult.data) {
        if (item.source_type === 'box') {
          // Короб в паллете — грузим items короба
          const boxResult = await db.boxes.getById(item.source_id)
          if (boxResult?.data) {
            const boxItemsResult = await db.boxItems.getByBoxId(item.source_id)
            if (boxItemsResult?.data) {
              for (const bi of boxItemsResult.data) {
                palletItems.value.push({
                  number: bi.barcode || '',
                  name: bi.name || 'Товар',
                  article: bi.brand || '',
                  comment: bi.comment || '',
                  isBoxItem: true,
                  boxName: boxResult.data.name || 'Короб'
                })
              }
            }
          }
        } else if (item.source_type === 'separate_item') {
          palletItems.value.push({
            number: item.item_barcode || String(item.source_id),
            name: item.item_name || 'Товар',
            article: item.item_brand || '',
            comment: item.item_comment || '',
            isBoxItem: false
          })
        } else if (item.source_type === 'inline') {
          palletItems.value.push({
            number: item.item_barcode || '',
            name: item.item_name || 'Товар',
            article: item.item_brand || '',
            comment: item.item_comment || '',
            isBoxItem: false
          })
        }
      }
    }

  } catch (err) {
    error.value = `Ошибка: ${err.message}`
  } finally {
    isLoading.value = false
  }
}

// Экспорт в Excel
async function exportToExcel() {
  try {
    const { exportPalletToExcel } = await import('@/utils/excel')
    const collector = {
      fullName: pallet.value.collector_full_name || '',
    }
    // Объединяем pallet items с загруженными palletItems
    const exportPallet = {
      ...pallet.value,
      items: palletItems.value.map(item => ({
        number: item.number,
        name: item.name,
        article: item.article,
        comment: item.comment,
      })),
    }
    const result = await exportPalletToExcel(exportPallet, collector)
    if (result.success) {
      window.showToast(`Файл скачан: ${result.filename}`)
    } else {
      window.showToast('Ошибка экспорта: ' + result.error)
    }
  } catch (err) {
    window.showToast('❌ Ошибка экспорта')
  }
}

// Форматирование даты
function formatDate(dateString) {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

// Загрузка при монтировании или смене route param
onMounted(() => {
  const palletId = route.params.palletId || route.query.id
  if (palletId) loadPallet(palletId)
})

watch(
  () => [route.params.palletId, route.query.id],
  ([newPalletId]) => {
    if (newPalletId) loadPallet(newPalletId)
  }
)
</script>

<template>
  <div class="pallet-detail-view min-h-screen bg-slate-900 pb-16">
    <!-- Nav Bar -->
    <NavBar
      title="Паллет"
      left-text="Назад"
      left-arrow
      @click-left="$router.back()"
    />

    <!-- Загрузка -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <p class="text-slate-400 text-lg">Загрузка паллета...</p>
    </div>

    <!-- Ошибка -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-20 px-8">
      <div class="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mb-4">
        <van-icon name="warning-o" size="32" color="#ef4444" />
      </div>
      <p class="text-red-400 text-lg font-medium text-center">{{ error }}</p>
    </div>

    <!-- Детали паллета -->
    <template v-else-if="pallet">
      <div class="p-4 flex-1 flex flex-col min-h-0">
        <!-- Карточка паллета -->
        <div
          class="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 text-white mb-4 flex-shrink-0 relative">
          <!-- Бейдж владельца -->
          <span v-if="pallet.collector_id && !isOwner(pallet.collector_id)" class="absolute top-[-10px] right-4 px-3 py-1 bg-red-500 border border-red-400 rounded-full text-xs font-bold text-white shadow-lg">
            ЧУЖОЙ — {{ pallet.collector_id }}
          </span>

          <div class="flex items-center gap-4 mb-3" :class="{ 'opacity-60 pointer-events-none': pallet.collector_id && !isOwner(pallet.collector_id) }">
            <div class="w-14 h-14 rounded-2xl bg-slate-700 border border-slate-600 flex items-center justify-center text-2xl flex-shrink-0">
              🏗️
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-lg truncate">{{ pallet.name || 'Паллет' }}</h3>
              <p class="text-xs text-slate-400 font-mono mt-1 break-all">{{ pallet.id }}</p>
            </div>
          </div>

          <!-- Инфо -->
          <div class="flex items-center gap-4 text-sm">
            <span>👤 Собирает: <strong class="text-slate-200">{{ pallet.collector_id || 'Неизвестный' }}</strong></span>
            <span class="text-slate-600">·</span>
            <span>📦 Позиций: <strong class="text-slate-200">{{ palletItems.length }}</strong></span>
          </div>

          <!-- Дата завершения -->
          <p v-if="pallet.finished_at" class="text-xs text-slate-500 mt-2 font-mono">
            Завершён {{ formatDate(pallet.finished_at) }}
          </p>
          <p v-else class="text-xs text-slate-500 mt-2 font-mono">
            Создан {{ formatDate(pallet.created_at) }}
          </p>
        </div>

        <!-- Содержимое паллета -->
        <div v-if="palletItems.length > 0" class="flex-1 flex flex-col min-h-0 overflow-hidden">
          <h4 class="text-sm font-medium text-slate-300 mb-2 shrink-0">Содержимое ({{ palletItems.length }} шт.)</h4>
          <div class="space-y-2 overflow-y-auto scrollbar-thin flex-1">
            <div
              v-for="(item, idx) in palletItems"
              :key="idx"
              class="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 transition-colors hover:bg-slate-700/60">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-slate-700 border border-slate-600 flex items-center justify-center flex-shrink-0">
                  <span class="text-xs font-bold text-slate-300">{{ idx + 1 }}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-100 truncate mb-0.5">{{ item.name }}</p>
                  <p class="text-xs text-slate-400 font-mono">{{ item.number }}</p>
                  <div v-if="item.article || item.comment" class="mt-1 space-y-0.5">
                    <p v-if="item.article" class="text-xs text-slate-500">{{ item.article }}</p>
                    <p v-if="item.comment" class="text-xs text-amber-300/70 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">
                      {{ item.comment }}
                    </p>
                  </div>
                  <p v-if="item.isBoxItem" class="text-xs text-indigo-400 mt-1">📦 {{ item.boxName }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Пустой паллет -->
        <div v-else class="flex items-center justify-center py-12">
          <div class="text-center">
            <div class="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-3">
              <van-icon name="bag-o" size="32" color="#475569" />
            </div>
            <p class="text-slate-500 text-sm">Паллет пуст</p>
          </div>
        </div>

        <!-- Кнопка экспорта (внизу карточки) -->
        <div v-if="isOwner(pallet.collector_id)" class="mt-4 shrink-0">
          <Button variant="success" block :disabled="palletItems.length === 0" @click="exportToExcel">
            📥 Экспорт в Excel ({{ palletItems.length }} позиций)
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
}
</style>
