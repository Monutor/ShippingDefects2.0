<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBrainStore } from '@/stores/brain'
import { NavBar } from '@/components/ui'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { buildLocationIndex, lookupLocation } from '@/utils/locations'

const router = useRouter()
const brainStore = useBrainStore()

const query = ref('')
const searched = ref(false)
const results = ref([])
const locationIndex = ref(null)
const searchInput = ref(null)
const showSuggestions = ref(false)

const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return (brainStore.items || [])
    .filter((item) => {
      const num = String(item.number || '').toLowerCase()
      const name = String(item.name || '').toLowerCase()
      const art = String(item.article || '').toLowerCase()
      return num.includes(q) || name.includes(q) || art.includes(q)
    })
    .slice(0, 20)
})

function selectSuggestion(item) {
  query.value = item.number
  showSuggestions.value = false
  runSearch()
}

function hideSuggestions() {
  window.setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}

onMounted(async () => {
  try {
    locationIndex.value = await buildLocationIndex()
  } catch {
    locationIndex.value = null
  }
  searchInput.value?.focus()
})

function runSearch() {
  const q = query.value.trim()
  if (!q) return
  const qLower = q.toLowerCase()
  let parsed = null
  try {
    parsed = parseBarcodeToBrainNumber(q)
  } catch {
    // Чужой магазин или профиль не настроен — поиск только по тексту
  }

  const exact = []
  const partial = []
  for (const item of brainStore.items || []) {
    const number = String(item.number || '')
    if ((parsed && number === parsed) || number === q) {
      exact.push(item)
      continue
    }
    if (
      number.toLowerCase().includes(qLower) ||
      String(item.name || '')
        .toLowerCase()
        .includes(qLower) ||
      String(item.article || '')
        .toLowerCase()
        .includes(qLower)
    ) {
      partial.push(item)
    }
  }
  results.value = [...exact, ...partial].slice(0, 50).map((item) => ({
    number: item.number,
    name: item.name,
    article: item.article,
    comment: item.comment,
    location: lookupLocation(locationIndex.value, item.number)
  }))
  searched.value = true
}

function goTo(result) {
  const loc = result.location
  if (!loc) {
    window.showToast('Товар нигде не размещён')
    return
  }
  if (loc.kind === 'box' && loc.boxId) router.push(`/mix/${loc.boxId}`)
  else if (loc.kind === 'pallet-inline' && loc.palletId) router.push(`/pallet/${loc.palletId}`)
  else router.push('/separate')
}
</script>

<template>
  <div class="search-view min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
    <NavBar title="Поиск" left-text="Назад" left-arrow @click-left="$router.back()" />

    <main class="px-4 py-4 mx-auto">
      <!-- Строка поиска: ТСД-сканер вводит сюда текст и жмёт Enter -->
      <form
        class="bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-2xl p-4 mb-4"
        @submit.prevent="runSearch"
      >
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
          <div class="relative flex-1">
            <input
              ref="searchInput"
              v-model="query"
              type="text"
              placeholder="Номер, название или код товара"
              class="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-2.5 outline-none text-slate-100 placeholder-slate-400 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
              @focus="showSuggestions = true"
              @blur="hideSuggestions"
            />
            <div
              v-if="showSuggestions && suggestions.length > 0"
              class="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-lg max-h-64 overflow-y-auto"
            >
              <button
                v-for="item in suggestions"
                :key="item.number"
                type="button"
                class="w-full text-left px-3 py-2 hover:bg-slate-700 flex items-center gap-2"
                @mousedown.prevent="selectSuggestion(item)"
              >
                <span class="text-xs font-mono text-slate-400">{{ item.number }}</span>
                <span class="text-sm text-slate-100 truncate">{{ item.name }}</span>
                <span v-if="item.article" class="text-xs text-slate-500 ml-auto">{{
                  item.article
                }}</span>
              </button>
            </div>
          </div>
          <button
            v-if="query"
            type="button"
            class="w-6 h-6 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
            @click="query = ''"
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
      </form>

      <!-- Пустое состояние -->
      <div v-if="!searched" class="empty-state py-16">
        <div
          class="w-24 h-24 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center mx-auto mb-6 border-2 border-primary-500/30"
        >
          <span class="text-5xl">🔍</span>
        </div>
        <p class="text-slate-400 text-sm">
          Введите номер, название или код — покажем, где лежит товар
        </p>
      </div>

      <!-- Ничего не найдено -->
      <div v-else-if="results.length === 0" class="empty-state py-16">
        <p class="text-slate-100 font-medium mb-1">Ничего не найдено</p>
        <p class="text-slate-400 text-sm">Проверьте запрос или загрузите базу брака</p>
      </div>

      <!-- Результаты -->
      <div v-else class="space-y-2">
        <p class="text-xs text-slate-500 px-1">Найдено: {{ results.length }}</p>
        <div
          v-for="(r, i) in results"
          :key="r.number + i"
          class="result-card p-4 cursor-pointer"
          @click="goTo(r)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="result-number">{{ r.number || '—' }}</p>
              <p class="text-slate-100 text-sm font-medium mt-1">{{ r.name || '—' }}</p>
              <p v-if="r.article" class="text-slate-500 text-xs mt-1">{{ r.article }}</p>
            </div>
            <span class="place-badge" :class="{ empty: !r.location }">
              {{ r.location ? r.location.label : '—' }}
            </span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.search-view {
  padding-bottom: 140px;
}

.empty-state {
  text-align: center;
}

.result-card {
  background: rgba(30, 41, 59, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1rem;
  transition: all 0.2s ease;
}

.result-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
}

.result-number {
  font-family: monospace;
  font-size: 0.875rem;
  color: #60a5fa;
  font-weight: 600;
}

.place-badge {
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: #7dd3fc;
  background: rgba(125, 211, 252, 0.12);
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  flex-shrink: 0;
  white-space: nowrap;
}

.place-badge.empty {
  color: #475569;
  background: transparent;
}
</style>
