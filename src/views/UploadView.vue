<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useBrainStore } from '@/stores/brain'
import { dbStore } from '@/lib/db'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { exportToExcel } from '@/utils/excel'
import { Button, NavBar, Modal } from '@/components/ui'

const brainStore = useBrainStore()

// Поиск
const searchQuery = ref('')

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return brainStore.items

  return brainStore.items.filter((item) => {
    const number = String(item.number || '').toLowerCase()
    const name = String(item.name || '').toLowerCase()
    const article = String(item.article || '').toLowerCase()
    const comment = String(item.comment || '').toLowerCase()
    return (
      number.includes(query) ||
      name.includes(query) ||
      article.includes(query) ||
      comment.includes(query)
    )
  })
})

const filteredTotal = computed(() => filteredItems.value.length)

// Пагинация
const currentPage = ref(1)
const itemsPerPage = ref(10)

const totalPages = computed(() => {
  return Math.ceil(filteredTotal.value / itemsPerPage.value)
})

// Сброс страницы при изменении поиска
watch(
  () => searchQuery.value,
  () => {
    currentPage.value = 1
  }
)

// Генерация кнопок пагинации для мобильных (максимум 5 видимых)
const pageButtons = computed(() => {
  const total = totalPages.value
  const current = currentPage.value

  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)

  const result = [1] // всегда первая

  if (current > 3) result.push(-1) // эллипсис

  // диапазон вокруг current
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let p = start; p <= end; p++) {
    if (!result.includes(p)) result.push(p)
  }

  if (current < total - 2) result.push(-2) // эллипсис

  result.push(total) // всегда последняя

  return result
})

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value
  const end = start + itemsPerPage.value
  return filteredItems.value.slice(start, end)
})

const showClearModal = ref(false)

async function confirmClear() {
  const result = await brainStore.clearDatabase()
  showClearModal.value = false

  if (result.clearedLocal) {
    window.showToast('✅ Локальная база очищена')
  } else {
    window.showToast('❌ Ошибка: ' + result.error)
  }
}

function goToPage(page) {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function isStopItem(item) {
  const comment = String(item.comment || '')
    .trim()
    .toLowerCase()
  if (comment === '') return true
  if (comment.includes('не согласован')) return true
  if (comment.includes('ждем согласования')) return true
  if (comment.includes('ждем решения')) return true
  return false
}

// Карта «штрихкод → место»: М3 (микс), П1 (паллет), М3 → П1 (микс в паллете), Отд (отдельные).
// Строится один раз при показе таблицы, а не по запросу на строку.
const locationMap = ref(new Map())

function addLocationKey(map, barcode, label) {
  if (!barcode) return
  if (!map.has(barcode)) map.set(barcode, label)
  const parsed = parseBarcodeToBrainNumber(barcode)
  if (parsed && !map.has(parsed)) map.set(parsed, label)
}

async function loadLocations() {
  const map = new Map()
  try {
    const boxesRes = await dbStore.boxes.getAll()
    const boxNum = new Map((boxesRes.data || []).map((b) => [b.id, b.box_number]))
    const palletsRes = await dbStore.pallets.getAll()
    const palletNum = new Map((palletsRes.data || []).map((p) => [p.id, p.pallet_number]))

    const boxToPallet = new Map()
    const inlineToPallet = new Map()
    const palletItemsRes = await dbStore.palletItems.getAll()
    for (const r of palletItemsRes.data || []) {
      const pn = palletNum.get(r.palletId)
      if (pn == null) continue
      if (r.source_type === 'box' && r.source_id != null && !boxToPallet.has(r.source_id)) {
        boxToPallet.set(r.source_id, pn)
      } else if (r.source_type === 'inline' || r.source_type === 'pallet') {
        const code = String(r.item_barcode || r.source_id || '')
        if (code && !inlineToPallet.has(code)) inlineToPallet.set(code, pn)
      }
    }

    const boxItemsRes = await dbStore.boxItems.getAll()
    for (const r of boxItemsRes.data || []) {
      const bn = boxNum.get(r.boxId)
      if (bn == null || !r.barcode) continue
      let label = `М${bn}`
      const pn = boxToPallet.get(r.boxId)
      if (pn != null) label += ` → П${pn}`
      addLocationKey(map, r.barcode, label)
    }
    for (const [code, pn] of inlineToPallet) addLocationKey(map, code, `П${pn}`)

    const sepRes = await dbStore.separateItems.getAll()
    for (const i of sepRes.data || []) {
      if (i.barcode) addLocationKey(map, i.barcode, 'Отд')
    }
  } catch {
    // ignore — колонка покажет прочерки
  }
  locationMap.value = map
}

function itemLocation(item) {
  return locationMap.value.get(String(item.number || '')) || '—'
}

// Выгрузка всей базы брака в Excel с колонкой «Место»
function downloadDatabase() {
  const rows = brainStore.items.map((item) => ({
    Номер: item.number || '',
    Наименование: item.name || '',
    'Код товара': item.article || '',
    Комментарий: item.comment || '',
    Место: itemLocation(item)
  }))
  const result = exportToExcel(rows, 'База_брака')
  if (result.success) {
    window.showToast(`База выгружена: ${rows.length} товаров`, 2500, 'success')
  } else {
    window.showToast('Не удалось выгрузить базу')
  }
}

onMounted(() => {
  if (brainStore.hasDatabase) loadLocations()
})

watch(
  () => brainStore.hasDatabase,
  (has) => {
    if (has) loadLocations()
  }
)
</script>

<template>
  <div
    class="upload-view min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pb-20"
  >
    <!-- Nav Bar -->
    <NavBar title="База данных" left-text="Назад" left-arrow @click-left="$router.back()" />

    <main class="content px-4 py-4">
      <!-- Пустое состояние -->
      <div v-if="!brainStore.hasDatabase" class="empty-state py-16">
        <div
          class="w-24 h-24 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center mx-auto mb-6 border-2 border-primary-500/30"
        >
          <span class="text-5xl">📄</span>
        </div>
        <h3 class="text-lg font-semibold text-slate-100 mb-2">База данных не загружена</h3>
        <p class="text-slate-400 text-sm mb-6">Загрузите Excel файл на главной странице</p>
        <Button @click="$router.push('/')">Перейти на главную</Button>
      </div>

      <!-- Таблица с данными -->
      <div v-else class="database-section">
        <!-- Заголовок -->
        <div class="bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-2xl p-4 mb-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold text-slate-100">Текущая база</h3>
              <p class="text-sm text-slate-400 mt-1">{{ brainStore.totalItems }} товаров</p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <div class="text-sm text-slate-400">
                Страница {{ currentPage }} из {{ totalPages }}
              </div>
              <Button size="sm" @click="downloadDatabase">Скачать</Button>
            </div>
          </div>
        </div>

        <!-- Поиск -->
        <div class="bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-2xl p-4 mb-4">
          <div class="flex items-center gap-3">
            <svg
              class="w-5 h-5 text-slate-500 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Поиск по номеру, наименованию, коду или комментарию"
              class="flex-1 bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-2.5 outline-none text-slate-100 placeholder-slate-400 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
            />
            <button
              v-if="searchQuery"
              class="w-6 h-6 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
              @click="searchQuery = ''"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div class="mt-2 text-xs text-slate-500">
            <template v-if="searchQuery">
              Найдено: {{ filteredTotal }} из {{ brainStore.totalItems }}
            </template>
            <template v-else> Всего: {{ brainStore.totalItems }} товаров </template>
          </div>
        </div>

        <!-- Таблица товаров -->
        <div
          class="bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-2xl overflow-hidden"
        >
          <div class="preview-table rounded-xl border border-slate-700 overflow-hidden">
            <div class="table-header">
              <span class="th-number">Номер</span>
              <span class="th-name">Наименование</span>
              <span class="th-article">Код</span>
              <span class="th-comment">Комментарий</span>
              <span class="th-place">Место</span>
            </div>
            <div
              v-for="(item, index) in paginatedItems"
              :key="index"
              :class="['table-row', { 'stop-row': isStopItem(item) }]"
            >
              <span class="td-number">{{ item.number || '—' }}</span>
              <span class="td-name">{{ item.name || '—' }}</span>
              <span class="td-article">{{ item.article || '—' }}</span>
              <span class="td-comment">
                <span v-if="isStopItem(item)" class="stop-badge">⛔</span>
                {{ item.comment || '—' }}
              </span>
              <span class="td-place" :class="{ empty: itemLocation(item) === '—' }">
                {{ itemLocation(item) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Пагинация -->
        <div class="pagination mt-4 flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            :disabled="currentPage === 1"
            class="custom-btn-secondary"
            @click="goToPage(currentPage - 1)"
          >
            Назад
          </Button>

          <!-- Кнопки страниц: максимум ~5 штук для мобильных -->
          <div class="pagination-numbers flex items-center gap-1 overflow-x-auto">
            <button
              v-for="btn in pageButtons"
              :key="btn"
              :class="[
                btn === -1 || btn === -2
                  ? 'pagination-ellipsis px-1 text-slate-500 select-none'
                  : 'pagination-btn w-8 h-8 rounded text-xs font-medium transition-all flex-shrink-0',
                currentPage === btn ? 'active' : ''
              ]"
              @click="btn > 0 && goToPage(btn)"
            >
              {{ btn < 0 ? '…' : btn }}
            </button>
          </div>

          <Button
            size="sm"
            variant="secondary"
            :disabled="currentPage === totalPages"
            class="custom-btn-secondary"
            @click="goToPage(currentPage + 1)"
          >
            Вперёд
          </Button>
        </div>
      </div>
    </main>

    <!-- Модальное окно очистки базы -->
    <Modal
      v-model="showClearModal"
      title="Удалить базу?"
      show-cancel
      confirm-text="Удалить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmClear"
    >
      <p class="text-slate-400 text-center">Вы уверены, что хотите удалить загруженную базу?</p>
      <p class="text-rose-400 text-sm text-center mt-2 font-medium">
        ⚠️ Это действие удалит все локальные данные!
      </p>
    </Modal>
  </div>
</template>

<style scoped>
.upload-view {
  padding-bottom: 140px;
}

/* Preview table */
.preview-table {
  width: 100%;
}

.table-header {
  display: none; /* Скрываем на мобильных */
}

.table-row {
  display: block;
  padding: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  background: rgba(255, 255, 255, 0.01);
}

.table-row:last-child {
  border-bottom: none;
}

/* Карточный вид для мобильных */
.td-number,
.td-name,
.td-article,
.td-comment,
.td-place {
  display: block;
  grid-column: auto !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.5rem;
}

.td-number {
  font-family: monospace;
  font-size: 0.875rem;
  color: #60a5fa;
  font-weight: 600;
}

.td-name {
  font-size: 1rem;
  color: #f1f5f9;
  font-weight: 500;
  white-space: normal;
  line-height: 1.4;
  margin-bottom: 0.75rem;
}

.td-article {
  font-family: monospace;
  font-size: 0.75rem;
  color: #64748b;
  background: rgba(100, 116, 139, 0.2);
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  display: inline-block;
  margin-bottom: 0.75rem;
}

.td-comment {
  font-size: 0.875rem;
  color: #94a3b8;
  white-space: normal;
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem;
  background: rgba(245, 158, 11, 0.1);
  border-left: 2px solid #f59e0b;
  border-radius: 0.375rem;
}

.stop-row .td-comment {
  background: rgba(239, 68, 68, 0.1);
  border-left-color: #ef4444;
  color: #fca5a5;
}

.stop-badge {
  flex-shrink: 0;
}

.td-place {
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: #7dd3fc;
  background: rgba(125, 211, 252, 0.12);
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  display: inline-block;
  margin-bottom: 0.25rem;
}

.td-place.empty {
  color: #475569;
  background: transparent;
  padding: 0.25rem 0;
}

/* Табличный вид для планшетов и десктопов (от 640px) */
@media (min-width: 640px) {
  .table-header {
    display: grid;
    grid-template-columns: 1.4fr 2.6fr 1.2fr 2.2fr 0.9fr;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgba(255, 255, 255, 0.03);
    font-weight: 600;
    font-size: 0.75rem;
    color: #94a3b8;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .table-row {
    display: grid;
    grid-template-columns: 1.4fr 2.6fr 1.2fr 2.2fr 0.9fr;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: transparent;
  }

  .td-number,
  .td-name,
  .td-article,
  .td-comment,
  .td-place {
    margin-bottom: 0;
  }

  .td-article {
    background: transparent;
    padding: 0;
  }

  .td-comment {
    background: transparent;
    border-left: none;
    padding: 0;
  }

  .stop-row .td-comment {
    background: rgba(239, 68, 68, 0.1);
    border-left: 3px solid #ef4444;
    padding: 0.5rem;
    border-radius: 0.375rem;
  }
}

/* Кастомные стили для кнопок */
.custom-btn-secondary {
  background: #334155 !important;
  border: 1px solid #475569 !important;
  color: #f1f5f9 !important;
  box-shadow: none !important;
}

.custom-btn-secondary:hover {
  background: #475569 !important;
}

/* Empty state */
.empty-state {
  text-align: center;
}

/* Pagination */
.pagination {
  flex-wrap: wrap;
}

.pagination-btn {
  background: rgba(51, 65, 85, 0.5);
  color: #94a3b8;
  border: 1px solid rgba(71, 85, 105, 0.5);
  cursor: pointer;
  transition: all 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background: rgba(51, 65, 85, 0.8);
  color: #f1f5f9;
}

.pagination-btn.active {
  background: linear-gradient(to right, #3b82f6, #2563eb);
  color: #ffffff;
  border-color: transparent;
}

.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination-ellipsis {
  font-size: 1rem;
}
</style>
