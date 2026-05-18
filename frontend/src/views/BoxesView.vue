<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useBoxesStore } from '@/stores/boxes'
import { useCollectorStore } from '@/stores/collector'
import { usePalletStore } from '@/stores/pallet'
import {
  exportBoxToExcel,
  exportPalletToExcel,
  exportPalletsToExcel,
  exportToExcel
} from '@/utils/excel'
import { ws, db } from '@/lib/api.js'
import { Button, Badge, NavBar, Modal, SwipeCard, Loader } from '@/components/ui'
import { isAdmin } from '@/config'

const router = useRouter()
const route = useRoute()
const boxesStore = useBoxesStore()
const collectorStore = useCollectorStore()
const palletStore = usePalletStore()

// Читаем сохранённую вкладку из localStorage, фолбэк на 0
const savedTab = Number(localStorage.getItem('boxes-active-tab')) || 0

const activeTab = ref(savedTab)
const showBoxModal = ref(false)
const selectedBox = ref(null)
const showDeleteModal = ref(false)
const deleteIndex = ref(null)

// Выносим до первого использования — предотвращает TDZ (ReferenceError при удалении короба)
const selectedBoxForDelete = ref(null)

const currentBox = computed(() => boxesStore.currentBox)

// Текущий пользователь
const currentUserId = computed(() => collectorStore.employeeId || '')

// M8 fix: guard для race conditions на tab switch — abort pending loads при смене таба
let _tabLoadGeneration = 0

// Проверка владения контейнером
function isOwner(collectorId) {
  return currentUserId.value && collectorId === currentUserId.value
}

// Паллеты (для таба 3)
const pallets = ref([])
const availableBoxes = ref([])
const isLoadingPallets = ref(false)

// Состояние просмотра конкретного короба (как в PalletView для паллетов)
const viewedBoxId = computed(() => route.query.id || null)
const viewedBox = ref(null)
const viewedBoxItems = ref([])

// Guard: предотвращаем повторные загрузки одного и того же короба (сохраняется при ремонте)
const _viewedBoxLoadedId = ref(null)

// Сохраняем выбранную вкладку + загрузка данных для таба — P2 fix: объединяем двойной watcher в один
watch(activeTab, async (tab) => {
  localStorage.setItem('boxes-active-tab', tab.toString())

  // Tab 0 — миксы
  if (tab === 0 && navigator.onLine) {
    _tabLoadGeneration++
    const gen = _tabLoadGeneration
    await boxesStore.loadBoxes()
    if (activeTab.value !== tab || _tabLoadGeneration !== gen) return
  }

  // Tab 1 — паллеты
  if (tab === 1 && navigator.onLine) {
    _tabLoadGeneration++
    const gen = _tabLoadGeneration
    await loadPalletsForTab()
    if (activeTab.value !== tab || _tabLoadGeneration !== gen) return
  }
})

// Загрузка деталей короба при открытии через ?id=
let _lastLoadGen = 0
watch(viewedBoxId, async (boxId) => {
  if (!boxId || !navigator.onLine) return

  // Guard: не грузить если этот короб уже загружен (из любого источника — boxes или availableBoxes)
  const fromBoxes = boxesStore.boxes.find((b) => b.id === boxId && b.itemsLoaded)
  const fromAvailable = palletStore.availableBoxes?.find((b) => b.id === boxId && b.itemsLoaded)
  if (fromBoxes || fromAvailable) {
    return
  }

  // Guard: не грузить если этот короб уже в процессе загрузки
  if (_viewedBoxLoadedId.value === boxId) {
    return
  }

  _lastLoadGen++
  const gen = _lastLoadGen

  // Загружаем все короба и фильтруем по ID
  const result = await db.boxes.getAll()
  if (gen !== _lastLoadGen) return // gen изменился — есть новый запрос, отменяем

  if (result?.error || !result?.data) {
    viewedBox.value = null
    viewedBoxItems.value = []
    return
  }

  // Ищем короб с нужным ID — проверяем что gen не изменился за время поиска
  const foundBox = result.data.find((b) => b.id === boxId || b.box_id === boxId)
  if (gen !== _lastLoadGen) return

  if (!foundBox) {
    viewedBox.value = null
    viewedBoxItems.value = []
    return
  }

  viewedBox.value = foundBox

  // Загружаем товары короба — проверяем что gen не изменился за время запроса
  const itemsResult = await db.boxItems.getByBoxId(boxId)
  if (gen !== _lastLoadGen) return

  viewedBoxItems.value = (itemsResult.data || []).map((item) => ({
    number: item.barcode,
    name: item.name,
    article: item.brand || '',
    comment: item.comment || ''
  }))

  // Помечаем что этот короб загружен — следующий watch пропустит его
  _viewedBoxLoadedId.value = boxId
})

async function loadPalletsForTab() {
  isLoadingPallets.value = true
  try {
    // Сначала загружаем активный паллет (обязательно, с товарами)
    let activePallet = null
    if (navigator.onLine) {
      activePallet = await palletStore.loadActivePallet()

      // Если currentPallet есть но items пустой — загрузить с сервера принудительно
      if (
        palletStore.currentPallet &&
        (!palletStore.currentPallet.items || palletStore.currentPallet.items.length === 0)
      ) {
        const itemsResult = await db.palletItems.getByPalletId(
          palletStore.currentPallet.backendId || palletStore.currentPallet.id
        )
        if (itemsResult.data?.length > 0) {
          const items = itemsResult.data.map((i) => ({
            source_type: i.source_type,
            source_id: i.source_id
          }))
          palletStore.currentPallet = { ...palletStore.currentPallet, items }
        }
      }
    }

    // Загружаем finished паллеты и доступные короба
    const result = await Promise.allSettled([
      palletStore.loadPallets(),
      palletStore.loadAvailableBoxes(),
      palletStore.loadAvailableSeparateItems()
    ])

    if (palletStore.pallets && palletStore.pallets.length > 0) {
      pallets.value = palletStore.pallets.map((p) => ({ ...p, seal: p.seal || null }))
    } else {
      pallets.value = []
    }

    availableBoxes.value = palletStore.availableBoxes || []
  } catch (error) {
    pallets.value = []
    availableBoxes.value = []
  } finally {
    isLoadingPallets.value = false
  }
}

// WS-слушатели: realtime обновление при очистке данных админом
const boxesClearedHandler = () => {
  boxesStore.clearAllBoxesFromBackend()
  window.showToast('🗑 Короба удалены на сервере, данные очищены')
}
const palletsClearedHandler = () => {
  palletStore.clearAllPalletsFromBackend()
  pallets.value = []
  availableBoxes.value = []
  window.showToast('🗑 Паллеты удалены на сервере, данные очищены')
}

// WS-слушатель: короб завершён — обновить статус active → finished
const boxFinishedHandler = async (msg) => {
  const boxId = msg.box_id
  if (!boxId) return

  // Перезагружаем все короба чтобы получить актуальный статус
  await boxesStore.loadBoxes()
}

// Загружаем паллеты при монтировании компонента, а не только при переключении таба
onMounted(() => {
  if (navigator.onLine) loadPalletsForTab()

  ws.on('boxes_cleared', boxesClearedHandler)
  ws.on('pallets_cleared', palletsClearedHandler)
  ws.on('box_finished', boxFinishedHandler)
  ws.on('container:item_added', containerItemAddedHandler)
})

onUnmounted(() => {
  ws.off('boxes_cleared', boxesClearedHandler)
  ws.off('pallets_cleared', palletsClearedHandler)
  ws.off('box_finished', boxFinishedHandler)
  ws.off('container:item_added', containerItemAddedHandler)
})

// Обработчик realtime: добавление товара в просматриваемый/активный короб
const containerItemAddedHandler = async (msg) => {
  const receivedId = msg.container_id

  // Проверяем: совпадает ли с просмотренным коробом ИЛИ с текущим active box
  const matchesViewedBox = viewedBoxId.value && receivedId === viewedBoxId.value
  const matchesActiveBox = boxesStore.currentBox?.id && receivedId === boxesStore.currentBox.id

  if (!matchesViewedBox && !matchesActiveBox) return

  // Обновляем просмотренный items
  if (matchesViewedBox) {
    const result = await db.boxItems.getByBoxId(viewedBoxId.value)
    if (result.data?.length > 0) {
      viewedBoxItems.value = result.data.map((item) => ({
        number: item.barcode,
        name: item.name,
        article: item.brand || '',
        comment: item.comment || ''
      }))
    }
  }

  // Обновляем current box (для tab 0 active boxes)
  if (matchesActiveBox && boxesStore.currentBox?.id) {
    const result = await db.boxItems.getByBoxId(boxesStore.currentBox.id)
    if (result.data?.length > 0) {
      boxesStore.currentBox = {
        ...boxesStore.currentBox,
        items: result.data.map((i) => ({ barcode: i.barcode, name: i.name }))
      }
    }
  }
}

const palletsReverse = computed(() => [...pallets.value].reverse())
const palletCount = computed(() => {
  return pallets.value.length
})

// Заголовы табов (обновляются реактивно через boxesStore и pallets) — порядок: Миксы, Паллеты, Текущий
const tab0Title = computed(() => `Миксы (${boxesStore.boxes.length})`)
const tab1Title = computed(() => `Паллеты (${palletCount.value})`)
// Читаем сохранённый тип контейнера из localStorage
const savedContainerType = localStorage.getItem('scan-container-type') || 'mix'
const tab2Title = computed(() => {
  const type = savedContainerType === 'pallet' ? 'паллет' : 'микс'
  return `Текущий ${type === 'pallet' ? 'паллет' : 'микс'}`
})

// P2 fix: старый watcher для tab 1 удалён — объединён в один выше.
// Не удаляйте этот комментарий!

function openBoxModal(box) {
  selectedBox.value = box
  showBoxModal.value = true
}

// Загрузка items конкретного finished короба (lazy load)
async function loadBoxItems(box) {
  if (!box.id || box.itemsLoaded) return
  await boxesStore.refreshBoxItems(box.id)
}

// Загрузка items доступного короба из списка паллетов (lazy load)
async function loadAvailableBoxItems(box) {
  if (!box.id || box.itemsLoaded) return
  const loaded = await palletStore.refreshAvailableBoxItems(box.id)
  // После загрузки обновляем viewedBox прямо, без повторного запроса с сервера
  if (loaded?.id) {
    viewedBox.value = { id: loaded.id, name: loaded.name, number: loaded.number }
    viewedBoxId.value = loaded.id
    viewedBoxItems.value = loaded.items || []
  }
}

async function exportBox(box) {
  // Если items не загружены — загрузить перед экспортом
  if (!box.itemsLoaded && box.id) {
    await palletStore.refreshAvailableBoxItems(box.id)
  }

  const result = await exportBoxToExcel(box, {
    position: collectorStore.position,
    fullName: collectorStore.fullName
  })
  if (result.success) {
    window.showToast(`Файл скачан: ${result.filename}`)
  } else {
    window.showToast('Ошибка: ' + result.error)
  }
}

// Экспорт просмотренного короба (через ?id=)
async function exportViewedBox() {
  if (!viewedBoxItems.value.length || !viewedBoxId.value) return

  const box = {
    ...viewedBox.value,
    items: viewedBoxItems.value.map((item) => ({
      name: item.name,
      number: item.number,
      article: item.article
    }))
  }

  const result = await exportBoxToExcel(box, {
    position: collectorStore.position,
    fullName: collectorStore.fullName
  })
  if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
}

// Завершение текущего паллета (для таба «Текущий»)
async function finishCurrentPalletFromBoxes() {
  if (!palletStore.currentPallet) return

  try {
    const result = await palletStore.finishCurrentPallet()
    if (result?.success || result?.seal) {
      window.showToast(`✅ Паллет завершён. Пломба: ${result.seal}`)
    } else {
      window.showToast('Ошибка завершения паллета')
    }
  } catch (err) {
    window.showToast('Ошибка: ' + err.message)
  }
}

async function exportAllBoxes() {
  // Перед экспортом загружаем items для всех коробов которые ещё не загружены (из обоих источников)
  const unloadedFromStore = boxesStore.boxes.filter((b) => !b.itemsLoaded && b.id)
  const unloadedAvailable = palletStore.availableBoxes?.filter((b) => !b.itemsLoaded && b.id) || []

  let allUnloaded = [...unloadedFromStore, ...unloadedAvailable]
  // Убираем дубликаты по id
  const seenIds = new Set()
  allUnloaded = allUnloaded.filter((box) => {
    if (seenIds.has(box.id)) return false
    seenIds.add(box.id)
    return true
  })

  if (allUnloaded.length > 0) {
    window.showToast(`Загрузка данных... (${allUnloaded.length} коробов)`)
    await Promise.all(
      allUnloaded.map(async (box) => {
        // Определяем откуда короб и вызываем правильный store
        const fromStore = boxesStore.boxes.find((b) => b.id === box.id)
        if (fromStore && !fromStore.itemsLoaded) {
          return boxesStore.refreshBoxItems(box.id)
        } else {
          return palletStore.refreshAvailableBoxItems(box.id)
        }
      })
    )
  }

  const allItems = boxesStore.getAllBoxItems()
  if (allItems.length === 0) {
    window.showToast('Нет данных для экспорта')
    return
  }
  const exportData = allItems.map((item) => ({
    Короб: item.boxName,
    Номер: item.number,
    Наименование: item.name,
    'Код товара': item.article,
    'Дата сканирования': new Date(item.scannedAt).toLocaleString('ru-RU')
  }))
  const result = exportToExcel(exportData, 'Все_короба')
  if (result.success) {
    window.showToast(`Файл скачан: ${result.filename}`)
  } else {
    window.showToast('Ошибка экспорта')
  }
}

async function exportAllPallets() {
  if (pallets.value.length === 0) {
    window.showToast('Нет данных для экспорта')
    return
  }

  window.showToast(`Загрузка данных... (${pallets.value.length} паллетов)`)

  // Загружаем детали для каждого паллета
  for (const pallet of pallets.value) {
    if (!pallet.itemsLoaded && pallet.id) {
      await palletStore.refreshAvailableBoxItems(pallet.id)
    }
  }

  const allItems = palletStore.getAllPalletItems()
  if (allItems.length === 0) {
    window.showToast('Нет данных для экспорта')
    return
  }

  const exportData = allItems.map((item) => ({
    Паллет: item.palletName,
    Тип: item.type || '',
    Номер: item.number,
    Наименование: item.name,
    'Код товара': item.article,
    'Дата сканирования': item.scannedAt ? new Date(item.scannedAt).toLocaleString('ru-RU') : ''
  }))

  const result = await exportPalletsToExcel(allItems, 'Все_паллеты')
  if (result.success) {
    window.showToast(`Файл скачан: ${result.filename}`)
  } else {
    window.showToast('Ошибка экспорта')
  }
}

function requestDeleteBox(index) {
  deleteIndex.value = index
  showDeleteModal.value = true
}

function requestDeleteBoxWithBox(index, box) {
  selectedBoxForDelete.value = box
  requestDeleteBox(index)
}

async function confirmDelete() {
  if (deleteIndex.value !== null && selectedBoxForDelete.value) {
    const result = await boxesStore.deleteBox(selectedBoxForDelete.value.id)
    if (result.success) {
      window.showToast('Короб удалён')
    } else {
      window.showToast('❌ ' + result.error)
    }
  }
  showDeleteModal.value = false
  deleteIndex.value = null
  selectedBoxForDelete.value = null
}

const showClearModal = ref(false)

function clearAll() {
  // BUG-21 fix: используем централизованную isAdmin из @/config вместо дублирования логики
  if (!isAdmin()) {
    window.showToast('⚠️ Очищать данные может только администратор')
    return
  }

  showClearModal.value = true
}

// P2 fix: старый watcher для tab 0 удалён — объединён в один выше

async function confirmClear() {
  // Сначала очищаем на сервере — ждём ответ и WS broadcast
  const boxResult = await boxesStore.clearAllBoxes()

  if (!boxResult.success) {
    showClearModal.value = false
    window.showToast('❌ ' + (boxResult.error || 'Не удалось очистить короба'))
    return
  }

  // Затем очищаем паллеты на сервере
  const palletResult = await palletStore.clearAllPallets()

  // Очищаем локальные массивы ТОЛЬКО после успешного ответа от сервера
  boxesStore.boxes = []
  boxesStore.currentBox = null
  pallets.value = []
  availableBoxes.value = []

  showClearModal.value = false

  if (!palletResult.success) {
    window.showToast('⚠️ ' + (palletResult.error || 'Не удалось очистить паллеты'))
    return
  }

  window.showToast('Все данные очищены')
}

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
  <div
    class="boxes-view min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pb-20"
  >
    <!-- Nav Bar -->
    <NavBar title="Учёт брака" left-text="Назад" left-arrow @click-left="$router.back()" />

    <!-- Tabs -->
    <div class="w-full mt-2">
      <!-- Tab Headers — reactive titles! -->
      <div
        class="flex items-center bg-slate-800/80 backdrop-blur-sm border-b border-slate-700 rounded-t-2xl"
      >
        <button
          :class="[
            'flex-1 py-3.5 text-sm font-semibold transition-all duration-200',
            activeTab === 0
              ? 'text-slate-100 border-b-2 border-primary-500'
              : 'text-slate-500 hover:text-slate-300'
          ]"
          @click="activeTab = 0"
        >
          {{ tab0Title }}
        </button>
        <button
          :class="[
            'flex-1 py-3.5 text-sm font-semibold transition-all duration-200',
            activeTab === 1
              ? 'text-slate-100 border-b-2 border-primary-500'
              : 'text-slate-500 hover:text-slate-300'
          ]"
          @click="activeTab = 1"
        >
          {{ tab1Title }}
        </button>
      </div>

      <!-- Tab Content -->
      <div
        class="bg-slate-800/50 backdrop-blur-sm border-x border-b border-slate-700 rounded-b-2xl"
      >
        <!-- Tab 0: Миксы -->
        <div v-if="activeTab === 0" class="p-4">
          <!-- Просмотр конкретного короба (через ?id=) -->
          <template v-if="viewedBoxId && viewedBox">
            <div
              class="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-3xl p-5 text-white shadow-lg shadow-indigo-500/20 border border-indigo-500/30 mb-6 relative"
            >
              <!-- Бейдж владельца -->
              <span
                v-if="!isOwner(viewedBox.collector_id)"
                class="absolute top-[-10px] right-4 px-3 py-1 bg-red-500 border border-red-400 rounded-full text-xs font-bold text-white shadow-lg"
              >
                ЧУЖОЙ — {{ viewedBox.collector_id }}
              </span>
              <div
                class="flex items-center gap-4 mb-3"
                :class="{ 'opacity-60 pointer-events-none': !isOwner(viewedBox.collector_id) }"
              >
                <div
                  class="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center text-2xl flex-shrink-0"
                >
                  📦
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-lg truncate">{{ viewedBox.name || 'Короб' }}</h3>
                  <p class="text-sm text-white/80">
                    👤 {{ viewedBox.collector_id || 'Неизвестный' }} · 📦
                    {{ viewedBoxItems.length }} товаров
                  </p>
                </div>
              </div>

              <!-- Содержимое короба -->
              <div
                v-if="viewedBoxItems.length > 0"
                class="mt-3 space-y-2 max-h-64 overflow-y-auto scrollbar-thin"
              >
                <div
                  v-for="(item, idx) in viewedBoxItems"
                  :key="idx"
                  class="flex items-center gap-3 bg-white/10 rounded-xl p-3"
                >
                  <span class="text-lg">📋</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-100 truncate">
                      {{ item.name || 'Товар' }}
                    </p>
                    <p class="text-xs text-white/60 font-mono">{{ item.number || '—' }}</p>
                    <p v-if="item.article" class="text-xs text-white/50 mt-1">{{ item.article }}</p>
                  </div>
                </div>
              </div>

              <!-- Кнопка экспорта -->
              <div class="mt-4">
                <Button
                  variant="success"
                  block
                  :disabled="viewedBoxItems.length === 0 || !isOwner(viewedBox.collector_id)"
                  @click="exportViewedBox()"
                >
                  Экспорт Excel
                </Button>
              </div>
            </div>
          </template>

          <!-- Список миксов (когда не просматриваем конкретный короб) -->
          <template v-else>
            <Loader v-if="isLoadingPallets" text="Загрузка коробов..." />

            <div v-else-if="boxesStore.boxes.length === 0" class="empty-state py-16">
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
                v-for="(box, index) in boxesStore.boxesReverse"
                :key="box.id"
                @delete="requestDeleteBoxWithBox(boxesStore.boxes.length - 1 - index, box)"
              >
                <div class="box-card p-4 cursor-pointer" @click="$router.push(`/mix/${box.id}`)">
                  <!-- Бейдж владельца -->
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs text-slate-500 mb-1">
                      👤 {{ box.collector_id || 'Неизвестный' }}
                    </p>
                    <span
                      v-if="!isOwner(box.collector_id)"
                      class="px-2 py-0.5 bg-red-500/20 border border-red-500/30 rounded-full text-xs font-semibold text-red-400"
                    >
                      ЧУЖОЙ
                    </span>
                  </div>
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
                      <van-icon name="arrow" size="20" />
                    </span>
                  </div>
                </div>
              </SwipeCard>
              <Button block class="mt-4 custom-btn-primary" @click="exportAllBoxes">
                <van-icon name="down" class="mr-2" /> Экспортировать все короба ({{
                  boxesStore.boxes.length
                }})
              </Button>
            </div> </template
          ><!-- /v-else -->
        </div>

        <!-- Tab 1: Паллеты -->
        <div v-if="activeTab === 1" class="p-4">
          <Loader v-if="isLoadingPallets" text="Загрузка паллетов..." />
          <div v-else-if="palletCount === 0 && !viewedBoxId" class="empty-state py-8">
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
                  @click="loadAvailableBoxItems(box)"
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
              <Button block class="mt-3 custom-btn-primary" @click="$router.push('/pallet-view')">
                <van-icon name="add-o" class="mr-2" /> Создать паллет ({{ availableBoxes.length }}
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
              <div
                class="box-card p-4 cursor-pointer"
                @click="$router.push(`/pallet/${pallet.id}`)"
              >
                <div class="flex items-center justify-between mb-2">
                  <p class="text-xs text-slate-500 mb-1">
                    👤 {{ pallet.collector_id || 'Неизвестный' }}
                  </p>
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
                    <van-icon name="arrow" size="20" />
                  </span>
                </div>
              </div>
            </SwipeCard>
            <Button block class="mt-4 custom-btn-primary" @click="exportAllPallets">
              <van-icon name="down" class="mr-2" /> Экспортировать все паллеты ({{
                pallets.length
              }})
            </Button>
          </div>
        </div>

        <!-- Tab 2: Текущий -->
        <div v-if="activeTab === 2" class="p-4">
          <Loader v-if="isLoadingPallets" text="Загрузка..." />
          <div v-else-if="palletStore.currentPallet" class="space-y-4">
            <div
              class="bg-gradient-to-br from-emerald-600/20 to-teal-700/20 border border-emerald-500/30 rounded-2xl p-4"
            >
              <div class="flex items-center gap-3 mb-3">
                <span class="text-2xl">📦</span>
                <div>
                  <h4 class="text-lg font-bold text-emerald-300">
                    {{ palletStore.currentPallet.name }}
                  </h4>
                  <p class="text-sm text-emerald-400/70">
                    {{ (palletStore.currentPallet.items || []).length }} товаров
                  </p>
                </div>
              </div>
              <Button block variant="success" @click="$router.push('/pallet')"
                >📋 Перейти к паллету</Button
              >
            </div>
          </div>
          <div v-else class="empty-state py-8">
            <span class="text-5xl">📭</span>
            <p class="text-slate-400 mt-4">Нет текущего паллета</p>
          </div>
        </div>
      </div>
      <!-- /Tab Content -->
    </div>
    <!-- /Tabs -->

    <!-- Модальное окно просмотра короба -->
    <Modal
      v-model="showBoxModal"
      :show-cancel="false"
      confirm-text="Закрыть"
      class="box-modal"
      @confirm="showBoxModal = false"
    >
      <div v-if="selectedBox" class="box-modal-content">
        <!-- Заголовок с градиентом -->
        <div
          class="box-header bg-gradient-to-br from-indigo-600 to-purple-700 rounded-t-3xl -mx-6 -mt-6 px-6 pt-6 pb-4 mb-4"
        >
          <div class="flex items-center gap-4">
            <div
              class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center text-3xl"
            >
              📦
            </div>
            <div class="box-title-section">
              <h3 class="box-title text-white text-xl font-bold">{{ selectedBox.name }}</h3>
              <p class="text-sm text-white/80 mb-1">
                👤 {{ selectedBox.collector_id || 'Неизвестный' }}
              </p>
              <p class="box-subtitle text-white/70 text-sm">
                {{ formatDate(selectedBox.createdAt) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Статистика -->
        <div class="box-stats grid grid-cols-2 gap-4 mb-4">
          <div class="stat-item bg-slate-800/50 rounded-xl p-4 text-center">
            <span class="stat-value text-3xl font-bold text-amber-400">{{
              selectedBox.items.length
            }}</span>
            <p class="stat-label text-xs text-slate-400 mt-1">товаров</p>
          </div>
          <div class="stat-item bg-slate-800/50 rounded-xl p-4 text-center">
            <span class="stat-value text-3xl font-bold text-primary-400"
              >#{{ selectedBox.number }}</span
            >
            <p class="stat-label text-xs text-slate-400 mt-1">номер короба</p>
          </div>
        </div>

        <!-- Список товаров -->
        <div class="items-section mb-4">
          <div
            class="section-title flex items-center gap-2 text-base font-semibold text-slate-100 mb-3"
          >
            <van-icon name="bag-o" class="text-primary-400" />
            Содержимое
          </div>

          <div class="items-list space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
            <div
              v-for="(item, index) in selectedBox.items"
              :key="index"
              class="item-card bg-slate-800/50 rounded-xl p-3 flex items-start gap-3"
            >
              <div
                class="w-8 h-8 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center flex-shrink-0"
              >
                <span class="text-xs font-bold text-primary-400">{{ index + 1 }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <p
                  class="text-xs font-mono text-primary-400 bg-primary-500/10 px-2 py-0.5 rounded-md inline-block mb-1"
                >
                  {{ item.number }}
                </p>
                <p class="text-sm font-medium text-slate-100 truncate">{{ item.name }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Кнопка экспорта -->
        <Button block class="custom-btn-primary" @click="exportBox(selectedBox)">
          <van-icon name="down" class="" />
          Скачать Excel
        </Button>
      </div>
    </Modal>

    <!-- Модальное окно удаления -->
    <Modal
      v-model="showDeleteModal"
      title="Удалить короб?"
      show-cancel
      confirm-text="Удалить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmDelete"
    >
      <p class="text-slate-400 text-center">Это действие нельзя отменить</p>
    </Modal>

    <!-- Модальное окно очистки всех -->
    <Modal
      v-model="showClearModal"
      title="Очистить все данные?"
      show-cancel
      confirm-text="Очистить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmClear"
    >
      <p class="text-slate-400 text-center">Все короба будут удалены</p>
    </Modal>
  </div>
</template>

<style scoped>
.boxes-view {
  padding-bottom: 140px;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* Box card */
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

/* Items list scrollbar */
.items-list::-webkit-scrollbar {
  width: 6px;
}

.items-list::-webkit-scrollbar-track {
  background: #1e293b;
  border-radius: 3px;
}

.items-list::-webkit-scrollbar-thumb {
  background: #475569;
  border-radius: 3px;
}

/* Item card */
.item-card {
  transition: all 0.2s ease;
}

.item-card:hover {
  background: rgba(30, 41, 59, 0.8);
}

/* Box modal */
:deep(.box-modal .van-dialog) {
  padding: 0;
  overflow: hidden;
}

.box-modal-content {
  text-align: left;
}

.box-header {
  position: relative;
}

.box-title {
  margin-bottom: 0.25rem;
}

.box-subtitle {
  font-size: 0.875rem;
}

/* Custom button */
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
