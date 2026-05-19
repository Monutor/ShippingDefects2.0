<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { auth, db } from '@/lib/api.js'
import Button from '@/components/ui/Button.vue'

const router = useRouter()
const route = useRoute()

// Состояние
const box = ref(null)
const boxItems = ref([])
const isLoading = ref(true)
const error = ref(null)

// Текущий пользователь и проверка владения
const currentUserId = computed(() => auth.getUserId() || '')
function isOwner(collectorId) {
  return currentUserId.value && collectorId === currentUserId.value
}

// Загрузка данных короба
async function loadBox(boxId) {
  isLoading.value = true
  error.value = null
  boxItems.value = []

  try {
    const boxResult = await db.boxes.getById(boxId)
    if (boxResult?.error || !boxResult?.data) {
      error.value = 'Короб не найден'
      box.value = null
      return
    }

    box.value = boxResult.data

    // Загружаем товары короба
    const itemsResult = await db.boxItems.getByBoxId(boxId)
    if (itemsResult?.data && Array.isArray(itemsResult.data)) {
      boxItems.value = itemsResult.data.map((i) => ({
        name: i.name || getItemField(i, 'name') || 'Товар',
        number: i.number || getItemField(i, 'barcode') || getItemField(i, 'item_barcode') || '—',
        article: i.article || i.brand || getItemField(i, 'article') || null,
        comment: i.comment || getItemField(i, 'comment') || null
      }))
    }
  } catch (err) {
    error.value = `Ошибка: ${err.message}`
  } finally {
    isLoading.value = false
  }
}

// Хелпер: извлекает поле из item_data_jsonb или прямое значение
function getItemField(item, field) {
  if (item[field]) return item[field]
  let data = item.item_data || item.item_data_jsonb
  if (!data) return null
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  return data?.[field] || null
}

// Экспорт в Excel
async function exportToExcel() {
  try {
    const { exportBoxToExcel } = await import('@/utils/excel')
    const collector = {
      fullName: box.value.collector_full_name || ''
    }
    // Объединяем box items с загруженными boxItems
    const exportBox = {
      ...box.value,
      items: boxItems.value.map((item) => ({
        number: item.number,
        name: item.name,
        article: item.article,
        comment: item.comment
      }))
    }
    const result = await exportBoxToExcel(exportBox, collector)
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
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Загрузка при монтировании или смене route param — M9: работает для /mix/xxx и /mix?id=xxx
onMounted(() => {
  const boxId = route.params.boxId || route.query.id
  if (boxId) loadBox(boxId)
})

watch(
  () => [route.params.boxId, route.query.id],
  ([newBoxId]) => {
    if (newBoxId) loadBox(newBoxId)
  }
)
</script>

<template>
  <div class="mix-detail-view min-h-screen bg-slate-900 pb-16">
    <!-- Nav Bar -->
    <NavBar title="Микс" left-text="Назад" left-arrow @click-left="$router.back()" />

    <!-- Загрузка -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <p class="text-slate-400 text-lg">Загрузка микса...</p>
    </div>

    <!-- Ошибка -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-20 px-8">
      <div
        class="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mb-4"
      >
        <van-icon name="warning-o" size="32" color="#ef4444" aria-hidden="true" />
      </div>
      <p class="text-red-400 text-lg font-medium text-center">{{ error }}</p>
    </div>

    <!-- Детали микса -->
    <template v-else-if="box">
      <div class="p-4 flex-1 flex flex-col min-h-0">
        <!-- Карточка микса -->
        <div
          class="bg-slate-800/80 border border-slate-700 rounded-3xl p-5 text-white mb-4 flex-shrink-0 relative"
        >
          <!-- Бейдж владельца -->
          <span
            v-if="box.collector_id && !isOwner(box.collector_id)"
            class="absolute top-[-10px] right-4 px-3 py-1 bg-red-500 border border-red-400 rounded-full text-xs font-bold text-white shadow-lg"
          >
            ЧУЖОЙ — {{ box.collector_id }}
          </span>

          <div
            class="flex items-center gap-4 mb-3"
            :class="{
              'opacity-60 pointer-events-none': box.collector_id && !isOwner(box.collector_id)
            }"
          >
            <div
              class="w-14 h-14 rounded-2xl bg-slate-700 border border-slate-600 flex items-center justify-center text-2xl flex-shrink-0"
            >
              📦
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-lg truncate">{{ box.name || 'Микс' }}</h3>
              <p class="text-xs text-slate-400 font-mono mt-1 break-all">{{ box.id }}</p>
            </div>
          </div>

          <!-- Инфо -->
          <div class="flex items-center gap-4 text-sm">
            <span
              >👤 Собирает:
              <strong class="text-slate-200">{{ box.collector_id || 'Неизвестный' }}</strong></span
            >
            <span class="text-slate-600">·</span>
            <span
              >📦 Товаров: <strong class="text-slate-200">{{ boxItems.length }}</strong></span
            >
          </div>

          <!-- Дата создания -->
          <p v-if="box.createdAt" class="text-xs text-slate-500 mt-2 font-mono">
            Создан {{ formatDate(box.createdAt) }}
          </p>
        </div>

        <!-- Содержимое короба -->
        <div v-if="boxItems.length > 0" class="flex-1 flex flex-col min-h-0 overflow-hidden">
          <h4 class="text-sm font-medium text-slate-300 mb-2 shrink-0">
            Содержимое ({{ boxItems.length }} шт.)
          </h4>
          <div class="space-y-2 overflow-y-auto scrollbar-thin flex-1">
            <div
              v-for="(item, idx) in boxItems"
              :key="idx"
              class="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 transition-colors hover:bg-slate-700/60"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded-lg bg-slate-700 border border-slate-600 flex items-center justify-center flex-shrink-0"
                >
                  <span class="text-xs font-bold text-slate-300">{{ idx + 1 }}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-100 truncate mb-0.5">
                    {{ item.name }}
                  </p>
                  <p class="text-xs text-slate-400 font-mono">{{ item.number }}</p>
                  <div v-if="item.article || item.comment" class="mt-1 space-y-0.5">
                    <p v-if="item.article" class="text-xs text-slate-500">{{ item.article }}</p>
                    <p
                      v-if="item.comment"
                      class="text-xs text-amber-300/70 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5"
                    >
                      {{ item.comment }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Пустой короб -->
        <div v-else class="flex items-center justify-center py-12">
          <div class="text-center">
            <div
              class="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-3"
            >
              <van-icon name="bag-o" size="32" color="#475569" aria-hidden="true" />
            </div>
            <p class="text-slate-500 text-sm">Короб пуст</p>
          </div>
        </div>

        <!-- Кнопка экспорта (внизу карточки) -->
        <div v-if="isOwner(box.collector_id)" class="mt-4 shrink-0">
          <Button variant="success" block :disabled="boxItems.length === 0" @click="exportToExcel">
            📥 Экспорт в Excel ({{ boxItems.length }} товаров)
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
