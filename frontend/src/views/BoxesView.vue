<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useBoxesStore } from '@/stores/boxes'
import { useCollectorStore } from '@/stores/collector'
import { usePalletStore } from '@/stores/pallet'
import { exportBoxToExcel, exportPalletsToExcel, exportToExcel } from '@/utils/excel'
import { ws, db } from '@/lib/api.js'
import { Button, NavBar, Modal, Loader } from '@/components/ui'
import { isAdmin } from '@/config'
import BoxesTab from '@/components/boxes/BoxesTab.vue'
import PalletsTab from '@/components/boxes/PalletsTab.vue'
import CurrentContainerTab from '@/components/boxes/CurrentContainerTab.vue'

const router = useRouter()
const route = useRoute()
const boxesStore = useBoxesStore()
const collectorStore = useCollectorStore()
const palletStore = usePalletStore()

const savedTab = Number(localStorage.getItem('boxes-active-tab')) || 0
const activeTab = ref(savedTab)
const showBoxModal = ref(false)
const selectedBox = ref(null)
const showDeleteModal = ref(false)
const deleteIndex = ref(null)
const selectedBoxForDelete = ref(null)
const currentUserId = computed(() => collectorStore.employeeId || '')

let _tabLoadGeneration = 0

function isOwner(collectorId) {
  return currentUserId.value && collectorId === currentUserId.value
}

const pallets = ref([])
const availableBoxes = ref([])
const isLoadingPallets = ref(false)

const viewedBoxId = computed(() => route.query.id || null)
const viewedBox = ref(null)
const viewedBoxItems = ref([])
const _viewedBoxLoadedId = ref(null)
let _lastLoadGen = 0

watch(activeTab, async (tab) => {
  localStorage.setItem('boxes-active-tab', tab.toString())
  if (tab === 0 && navigator.onLine) {
    _tabLoadGeneration++
    const gen = _tabLoadGeneration
    await boxesStore.loadBoxes()
    if (activeTab.value !== tab || _tabLoadGeneration !== gen) return
  }
  if (tab === 1 && navigator.onLine) {
    _tabLoadGeneration++
    const gen = _tabLoadGeneration
    await loadPalletsForTab()
    if (activeTab.value !== tab || _tabLoadGeneration !== gen) return
  }
})

watch(viewedBoxId, async (boxId) => {
  if (!boxId || !navigator.onLine) return
  const fromBoxes = boxesStore.boxes.find((b) => b.id === boxId && b.itemsLoaded)
  const fromAvailable = palletStore.availableBoxes?.find((b) => b.id === boxId && b.itemsLoaded)
  if (fromBoxes || fromAvailable) return
  if (_viewedBoxLoadedId.value === boxId) return

  _lastLoadGen++
  const gen = _lastLoadGen
  const result = await db.boxes.getAll()
  if (gen !== _lastLoadGen) return
  if (result?.error || !result?.data) {
    viewedBox.value = null
    viewedBoxItems.value = []
    return
  }
  const foundBox = result.data.find((b) => b.id === boxId || b.box_id === boxId)
  if (gen !== _lastLoadGen) return
  if (!foundBox) {
    viewedBox.value = null
    viewedBoxItems.value = []
    return
  }
  viewedBox.value = foundBox
  const itemsResult = await db.boxItems.getByBoxId(boxId)
  if (gen !== _lastLoadGen) return
  viewedBoxItems.value = (itemsResult.data || []).map((item) => ({
    number: item.barcode,
    name: item.name,
    article: item.brand || '',
    comment: item.comment || ''
  }))
  _viewedBoxLoadedId.value = boxId
})

async function loadPalletsForTab() {
  isLoadingPallets.value = true
  try {
    let activePallet = null
    if (navigator.onLine) {
      activePallet = await palletStore.loadActivePallet()
      if (
        palletStore.currentPallet &&
        (!palletStore.currentPallet.items || palletStore.currentPallet.items.length === 0)
      ) {
        const itemsResult = await db.palletItems.getByPalletId(
          palletStore.currentPallet.backendId || palletStore.currentPallet.id
        )
        if (itemsResult.data?.length > 0) {
          palletStore.currentPallet = { ...palletStore.currentPallet, items: itemsResult.data.map((i) => ({ source_type: i.source_type, source_id: i.source_id })) }
        }
      }
    }
    await Promise.allSettled([
      palletStore.loadPallets(),
      palletStore.loadAvailableBoxes(),
      palletStore.loadAvailableSeparateItems()
    ])
    pallets.value = palletStore.pallets?.length > 0 ? palletStore.pallets.map((p) => ({ ...p, seal: p.seal || null })) : []
    availableBoxes.value = palletStore.availableBoxes || []
  } catch {
    pallets.value = []
    availableBoxes.value = []
  } finally {
    isLoadingPallets.value = false
  }
}

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
const boxFinishedHandler = async () => {
  await boxesStore.loadBoxes()
}
const containerItemAddedHandler = async (msg) => {
  const receivedId = msg.container_id
  const matchesViewedBox = viewedBoxId.value && receivedId === viewedBoxId.value
  const matchesActiveBox = boxesStore.currentBox?.id && receivedId === boxesStore.currentBox.id
  if (!matchesViewedBox && !matchesActiveBox) return
  if (matchesViewedBox) {
    const result = await db.boxItems.getByBoxId(viewedBoxId.value)
    if (result.data?.length > 0) {
      viewedBoxItems.value = result.data.map((item) => ({ number: item.barcode, name: item.name, article: item.brand || '', comment: item.comment || '' }))
    }
  }
  if (matchesActiveBox && boxesStore.currentBox?.id) {
    const result = await db.boxItems.getByBoxId(boxesStore.currentBox.id)
    if (result.data?.length > 0) {
      boxesStore.currentBox = { ...boxesStore.currentBox, items: result.data.map((i) => ({ barcode: i.barcode, name: i.name })) }
    }
  }
}

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

const tab0Title = computed(() => `Миксы (${boxesStore.boxes.length})`)
const tab1Title = computed(() => `Паллеты (${pallets.value.length})`)

function openBoxModal(box) {
  selectedBox.value = box
  showBoxModal.value = true
}

async function loadAvailableBoxItems(box) {
  if (!box.id || box.itemsLoaded) return
  const loaded = await palletStore.refreshAvailableBoxItems(box.id)
  if (loaded?.id) {
    viewedBox.value = { id: loaded.id, name: loaded.name, number: loaded.number }
    viewedBoxItems.value = loaded.items || []
  }
}

async function exportBox(box) {
  if (!box.itemsLoaded && box.id) await palletStore.refreshAvailableBoxItems(box.id)
  const result = await exportBoxToExcel(box, { position: collectorStore.position, fullName: collectorStore.fullName })
  if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
  else window.showToast('Ошибка: ' + result.error)
}

async function exportViewedBox() {
  if (!viewedBoxItems.value.length || !viewedBoxId.value) return
  const box = { ...viewedBox.value, items: viewedBoxItems.value.map((item) => ({ name: item.name, number: item.number, article: item.article })) }
  const result = await exportBoxToExcel(box, { position: collectorStore.position, fullName: collectorStore.fullName })
  if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
}

async function exportAllBoxes() {
  const unloadedFromStore = boxesStore.boxes.filter((b) => !b.itemsLoaded && b.id)
  const unloadedAvailable = palletStore.availableBoxes?.filter((b) => !b.itemsLoaded && b.id) || []
  let allUnloaded = [...unloadedFromStore, ...unloadedAvailable]
  const seenIds = new Set()
  allUnloaded = allUnloaded.filter((box) => { if (seenIds.has(box.id)) return false; seenIds.add(box.id); return true })
  if (allUnloaded.length > 0) {
    window.showToast(`Загрузка данных... (${allUnloaded.length} коробов)`)
    await Promise.all(allUnloaded.map(async (box) => {
      const fromStore = boxesStore.boxes.find((b) => b.id === box.id)
      return fromStore && !fromStore.itemsLoaded ? boxesStore.refreshBoxItems(box.id) : palletStore.refreshAvailableBoxItems(box.id)
    }))
  }
  const allItems = boxesStore.getAllBoxItems()
  if (allItems.length === 0) { window.showToast('Нет данных для экспорта'); return }
  const exportData = allItems.map((item) => ({ Короб: item.boxName, Номер: item.number, Наименование: item.name, 'Код товара': item.article, 'Дата сканирования': new Date(item.scannedAt).toLocaleString('ru-RU') }))
  const result = exportToExcel(exportData, 'Все_короба')
  if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
  else window.showToast('Ошибка экспорта')
}

async function exportAllPallets() {
  if (pallets.value.length === 0) { window.showToast('Нет данных для экспорта'); return }
  window.showToast(`Загрузка данных... (${pallets.value.length} паллетов)`)
  for (const pallet of pallets.value) {
    if (!pallet.itemsLoaded && pallet.id) await palletStore.refreshAvailableBoxItems(pallet.id)
  }
  const allItems = palletStore.getAllPalletItems()
  if (allItems.length === 0) { window.showToast('Нет данных для экспорта'); return }
  const result = await exportPalletsToExcel(allItems, 'Все_паллеты')
  if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
  else window.showToast('Ошибка экспорта')
}

function requestDeleteBoxWithBox(index, box) {
  selectedBoxForDelete.value = box
  deleteIndex.value = index
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (deleteIndex.value !== null && selectedBoxForDelete.value) {
    const result = await boxesStore.deleteBox(selectedBoxForDelete.value.id)
    if (result.success) window.showToast('Короб удалён')
    else window.showToast('❌ ' + result.error)
  }
  showDeleteModal.value = false
  deleteIndex.value = null
  selectedBoxForDelete.value = null
}

const showClearModal = ref(false)
function clearAll() {
  if (!isAdmin()) { window.showToast('⚠️ Очищать данные может только администратор'); return }
  showClearModal.value = true
}

async function confirmClear() {
  const boxResult = await boxesStore.clearAllBoxes()
  if (!boxResult.success) { showClearModal.value = false; window.showToast('❌ ' + (boxResult.error || 'Не удалось очистить короба')); return }
  const palletResult = await palletStore.clearAllPallets()
  boxesStore.boxes = []
  boxesStore.currentBox = null
  pallets.value = []
  availableBoxes.value = []
  showClearModal.value = false
  if (!palletResult.success) { window.showToast('⚠️ ' + (palletResult.error || 'Не удалось очистить паллеты')); return }
  window.showToast('Все данные очищены')
}
</script>

<template>
  <div class="boxes-view min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pb-20">
    <NavBar title="Учёт брака" left-text="Назад" left-arrow @click-left="$router.back()" />

    <div class="w-full mt-2">
      <div class="flex items-center bg-slate-800/80 backdrop-blur-sm border-b border-slate-700 rounded-t-2xl">
        <button :class="['flex-1 py-3.5 text-sm font-semibold transition-all duration-200', activeTab === 0 ? 'text-slate-100 border-b-2 border-primary-500' : 'text-slate-500 hover:text-slate-300']" @click="activeTab = 0">{{ tab0Title }}</button>
        <button :class="['flex-1 py-3.5 text-sm font-semibold transition-all duration-200', activeTab === 1 ? 'text-slate-100 border-b-2 border-primary-500' : 'text-slate-500 hover:text-slate-300']" @click="activeTab = 1">{{ tab1Title }}</button>
      </div>

      <div class="bg-slate-800/50 backdrop-blur-sm border-x border-b border-slate-700 rounded-b-2xl">
        <!-- Tab 0: Миксы -->
        <template v-if="activeTab === 0">
          <template v-if="viewedBoxId && viewedBox">
            <div class="p-4">
              <div class="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-3xl p-5 text-white shadow-lg shadow-indigo-500/20 border border-indigo-500/30 mb-6 relative">
                <span v-if="!isOwner(viewedBox.collector_id)" class="absolute top-[-10px] right-4 px-3 py-1 bg-red-500 border border-red-400 rounded-full text-xs font-bold text-white shadow-lg">ЧУЖОЙ — {{ viewedBox.collector_id }}</span>
                <div class="flex items-center gap-4 mb-3" :class="{ 'opacity-60 pointer-events-none': !isOwner(viewedBox.collector_id) }">
                  <div class="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center text-2xl flex-shrink-0">📦</div>
                  <div class="flex-1 min-w-0">
                    <h3 class="font-semibold text-lg truncate">{{ viewedBox.name || 'Короб' }}</h3>
                    <p class="text-sm text-white/80">👤 {{ viewedBox.collector_id || 'Неизвестный' }} · 📦 {{ viewedBoxItems.length }} товаров</p>
                  </div>
                </div>
                <div v-if="viewedBoxItems.length > 0" class="mt-3 space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                  <div v-for="(item, idx) in viewedBoxItems" :key="idx" class="flex items-center gap-3 bg-white/10 rounded-xl p-3">
                    <span class="text-lg">📋</span>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-slate-100 truncate">{{ item.name || 'Товар' }}</p>
                      <p class="text-xs text-white/60 font-mono">{{ item.number || '—' }}</p>
                      <p v-if="item.article" class="text-xs text-white/50 mt-1">{{ item.article }}</p>
                    </div>
                  </div>
                </div>
                <div class="mt-4">
                  <Button variant="success" block :disabled="viewedBoxItems.length === 0 || !isOwner(viewedBox.collector_id)" @click="exportViewedBox()">Экспорт Excel</Button>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <BoxesTab :boxes="boxesStore.boxes" :is-loading="isLoadingPallets" @request-delete="requestDeleteBoxWithBox" @export-all="exportAllBoxes" />
          </template>
        </template>

        <!-- Tab 1: Паллеты -->
        <PalletsTab v-if="activeTab === 1" :pallets="pallets" :available-boxes="availableBoxes" :is-loading="isLoadingPallets" :is-owner="isOwner" @load-box-items="loadAvailableBoxItems" @export-all="exportAllPallets" />

        <!-- Tab 2: Текущий -->
        <CurrentContainerTab v-if="activeTab === 2" :is-loading="isLoadingPallets" />
      </div>
    </div>

    <!-- Модальное окно просмотра короба -->
    <Modal v-model="showBoxModal" :show-cancel="false" confirm-text="Закрыть" class="box-modal" @confirm="showBoxModal = false">
      <div v-if="selectedBox" class="box-modal-content">
        <div class="box-header bg-gradient-to-br from-indigo-600 to-purple-700 rounded-t-3xl -mx-6 -mt-6 px-6 pt-6 pb-4 mb-4">
          <div class="flex items-center gap-4">
            <div class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center text-3xl">📦</div>
            <div class="box-title-section">
              <h3 class="box-title text-white text-xl font-bold">{{ selectedBox.name }}</h3>
              <p class="text-sm text-white/80 mb-1">👤 {{ selectedBox.collector_id || 'Неизвестный' }}</p>
              <p class="box-subtitle text-white/70 text-sm">{{ new Date(selectedBox.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</p>
            </div>
          </div>
        </div>
        <div class="box-stats grid grid-cols-2 gap-4 mb-4">
          <div class="stat-item bg-slate-800/50 rounded-xl p-4 text-center">
            <span class="stat-value text-3xl font-bold text-amber-400">{{ selectedBox.items.length }}</span>
            <p class="stat-label text-xs text-slate-400 mt-1">товаров</p>
          </div>
          <div class="stat-item bg-slate-800/50 rounded-xl p-4 text-center">
            <span class="stat-value text-3xl font-bold text-primary-400">#{{ selectedBox.number }}</span>
            <p class="stat-label text-xs text-slate-400 mt-1">номер короба</p>
          </div>
        </div>
        <div class="items-section mb-4">
          <div class="section-title flex items-center gap-2 text-base font-semibold text-slate-100 mb-3"><van-icon name="bag-o" class="text-primary-400" aria-hidden="true" /> Содержимое</div>
          <div class="items-list space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
            <div v-for="(item, index) in selectedBox.items" :key="index" class="item-card bg-slate-800/50 rounded-xl p-3 flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center flex-shrink-0"><span class="text-xs font-bold text-primary-400">{{ index + 1 }}</span></div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-mono text-primary-400 bg-primary-500/10 px-2 py-0.5 rounded-md inline-block mb-1">{{ item.number }}</p>
                <p class="text-sm font-medium text-slate-100 truncate">{{ item.name }}</p>
              </div>
            </div>
          </div>
        </div>
        <Button block class="custom-btn-primary" @click="exportBox(selectedBox)"><van-icon name="down" class="" aria-hidden="true" /> Скачать Excel</Button>
      </div>
    </Modal>

    <Modal v-model="showDeleteModal" title="Удалить короб?" show-cancel confirm-text="Удалить" cancel-text="Отмена" confirm-color="danger" @confirm="confirmDelete">
      <p class="text-slate-400 text-center">Это действие нельзя отменить</p>
    </Modal>

    <Modal v-model="showClearModal" title="Очистить все данные?" show-cancel confirm-text="Очистить" cancel-text="Отмена" confirm-color="danger" @confirm="confirmClear">
      <p class="text-slate-400 text-center">Все короба будут удалены</p>
    </Modal>
  </div>
</template>

<style scoped>
.boxes-view { padding-bottom: 140px; }
.custom-btn-primary { background: linear-gradient(to right, #3b82f6, #2563eb) !important; border: none !important; color: #ffffff !important; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4) !important; }
.custom-btn-primary:hover { background: linear-gradient(to right, #2563eb, #1d4ed8) !important; box-shadow: 0 4px 16px rgba(59, 130, 246, 0.5) !important; }
:deep(.box-modal .van-dialog) { padding: 0; overflow: hidden; }
.box-modal-content { text-align: left; }
.item-card { transition: all 0.2s ease; }
.item-card:hover { background: rgba(30, 41, 59, 0.8); }
</style>
