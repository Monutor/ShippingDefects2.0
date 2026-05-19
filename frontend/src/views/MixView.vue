<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBrainStore } from '@/stores/brain'
import { useBoxesStore } from '@/stores/boxes'
import { useCollectorStore } from '@/stores/collector'
import { useScanner } from '@/composables/useScanner'
import { parseBarcodeToBrainNumber, ensurePrefix } from '@/utils/barcode'
import { playSound } from '@/utils/sound'
import { Button, Input, Badge, NavBar, Modal } from '@/components/ui'
import { db, ws } from '@/lib/api.js'

const router = useRouter()
const brainStore = useBrainStore()
const boxesStore = useBoxesStore()
const collectorStore = useCollectorStore()

watch(
  () => boxesStore.currentBox?.items?.length,
  (newLength) => { nextTick(() => {}) }
)

const showScanner = ref(false)
const showStopItemModal = ref(false)
const currentStopItem = ref(null)
const showFinishModal = ref(false)

const showRemoveModal = ref(false)
const removeItemRef = ref(null)

function requestRemoveItem(item) {
  removeItemRef.value = item
  showRemoveModal.value = true
}

async function confirmRemoveItem() {
  if (removeItemRef.value) {
    boxesStore.removeItemFromCurrentBox(removeItemRef.value)
    window.showToast('Товар удалён')
  }
  showRemoveModal.value = false
  removeItemRef.value = null
}

const activeBoxes = ref([])
const _allActiveBoxes = ref([])

function boxCreatedHandler(msg) {
  if (msg.box_id && !_allActiveBoxes.value.find((b) => b.id === msg.box_id)) {
    const newBox = { id: msg.box_id, collector_id: msg.collector_id }
    if (msg.collector_id === collectorStore.employeeId) {
      activeBoxes.value.push(newBox)
      if (!boxesStore.currentBox || boxesStore.currentBox.id !== msg.box_id) {
        boxesStore.currentBox = newBox
      }
    }
    _allActiveBoxes.value.push(newBox)
  }
}

function boxFinishedHandler(msg) {
  if (boxesStore.currentBox?.id === msg.box_id) boxesStore.currentBox = null
  activeBoxes.value = activeBoxes.value.filter((b) => b.id !== msg.box_id)
  _allActiveBoxes.value = _allActiveBoxes.value.filter((b) => b.id !== msg.box_id)
}

async function loadActiveContainers() {
  if (!navigator.onLine) return
  const allBoxes = (await boxesStore.loadAllActiveBoxes()) || []
  activeBoxes.value = allBoxes.filter((b) => b.collector_id === collectorStore.employeeId)
  _allActiveBoxes.value = allBoxes
}

function selectBox(box) {
  if (box.collector_id && box.collector_id !== collectorStore.employeeId) {
    window.showToast('⚠️ Нельзя открыть чужой микс', 2000, 'error')
    return
  }
  boxesStore.currentBox = box
  window.showToast(`Открыт микс ${box.name || ''}`, 2000, 'default')
  if (!box.itemsLoaded && !box.items?.length) {
    boxesStore.refreshBoxItems(box.id).then(() => {})
  }
}

async function createAndSelectNewBox() {
  const oldBoxId = boxesStore.currentBox?.id
  await boxesStore.createBox()
  await loadActiveContainers()
  if (activeBoxes.value.length > 0) {
    const last = activeBoxes.value[activeBoxes.value.length - 1]
    if (boxesStore.currentBox?.id === oldBoxId) {}
    selectBox(last)
  }
}

async function processScannedCode(barcode) {
  const item = brainStore.findByBarcode(barcode)
  if (item?.comment && /не согласован|ждем согласования|ждем решения/i.test(item.comment)) {
    currentStopItem.value = item
    showStopItemModal.value = true
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    playSound('error')
    return null
  }

  const normalizedBarcode = ensurePrefix(parseBarcodeToBrainNumber(barcode))
  if (!normalizedBarcode) {
    window.showToast(`Неверный формат: ${barcode}`)
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    playSound('error')
    return null
  }

  const duplicateInOthers = boxesStore.checkGlobalDuplicate(normalizedBarcode)
  if (duplicateInOthers) {
    window.showToast(`️ Товар уже в миксе №${duplicateInOthers.boxNumber}`, 5000, 'error')
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    playSound('error')
    return null
  }

  const result = await boxesStore.addItemToCurrentBox(
    item || { number: normalizedBarcode, name: `Товар ${normalizedBarcode}` }
  )
  if (result.success) {
    window.showToast(`✅ Товар добавлен`, 1000, 'success')
    return { name: item?.name || `Товар ${normalizedBarcode}`, barcode }
  } else {
    if (result.error === 'duplicate_global') {
      window.showToast(`️ Товар уже в миксе №${result.boxNumber}`, 5000, 'error')
    } else if (result.error === 'duplicate_server') {
      window.showToast(`⚠️ Товар уже в миксе №${result.boxNumber}`, 5000, 'error')
    } else if (result.error === 'duplicate_current') {
      window.showToast(`⚠️ Товар уже в текущем миксе`, 5000, 'error')
    } else {
      window.showToast(`️ Не удалось добавить товар`, 3000, 'error')
    }
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    playSound('error')
    return null
  }
}

async function startScanner() {
  if (!navigator.onLine) return
  showScanner.value = true
  await nextTick()
  await sc.startScanner()
}

function handleStopScanner() {
  sc.stopScanner()
  showScanner.value = false
}

async function finishBox() {
  if (!boxesStore.currentBox || boxesStore.currentBoxItemsCount === 0) {
    window.showToast('Короб пуст')
    return
  }
  showFinishModal.value = true
}

async function confirmFinish() {
  showFinishModal.value = false
  const finishedBox = await boxesStore.finishCurrentBox()
  if (finishedBox) {
    window.showToast(`✅ Микс ${finishedBox.name} завершён. Пломба: ${finishedBox.seal}`)
    try {
      const { exportBoxToExcel } = await import('@/utils/excel')
      const collector = { fullName: collectorStore.fullName || '', position: collectorStore.position || '' }
      const result = await exportBoxToExcel(finishedBox, collector)
      if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
    } catch {}
    await loadActiveContainers()
    if (!boxesStore.currentBox?.backendId || boxesStore.currentBox.status === 'finished') {
      boxesStore.currentBox = null
    }
  } else {
    window.showToast(` Ошибка завершения микса: ${boxesStore.syncError || 'неизвестная ошибка'}`)
  }
}

function cancelBox() { boxesStore.cancelCurrentBox() }

async function performUndo() {
  const undoneItem = await boxesStore.undoLastAction()
  if (undoneItem) {
    playSound('undo')
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    window.showToast(`Отменено: ${undoneItem.name || undoneItem.number}`, 2000, 'default')
  } else {
    window.showToast('Нечего отменять', 1500, 'error')
  }
}

function removeItem(item) { requestRemoveItem(item) }

const isContainerOwner = computed(() => {
  const container = boxesStore.currentBox
  if (!container?.collector_id) return true
  return container.collector_id === collectorStore.employeeId
})

const sc = useScanner({
  elementId: 'barcode-scanner',
  onScanSuccess: processScannedCode,
  onScanComplete: () => { showScanner.value = false }
})

onMounted(async () => {
  ws.on('box_created', boxCreatedHandler)
  ws.on('box_finished', boxFinishedHandler)
  if (navigator.onLine) await loadActiveContainers()
  if (activeBoxes.value.length > 0 && !boxesStore.currentBox) {
    const myBox = activeBoxes.value.find((b) => b.collector_id === collectorStore.employeeId)
    if (myBox) boxesStore.currentBox = myBox
  }
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  ws.off('box_created', boxCreatedHandler)
  ws.off('box_finished', boxFinishedHandler)
  sc.cleanupScanner()
  window.removeEventListener('keydown', handleKeyDown)
})

function handleKeyDown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
    event.preventDefault()
    performUndo()
  }
}
</script>

<template>
  <div class="mix-view bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
    <NavBar
      title="Миксы"
      left-text="Назад"
      left-arrow
      :right-text="activeBoxes.length > 0 ? 'Смотреть' : 'Результаты'"
      @click-left="$router.back()"
      @click-right="activeBoxes.length > 0 ? $router.push({ path: '/mix', query: { id: activeBoxes[0].id } }) : $router.push('/boxes')"
    />

    <main class="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
      <div v-if="boxesStore.currentBox" class="status-bar bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-center">
        <div class="flex items-center justify-center gap-3 mb-2">
          <Badge :count="boxesStore.currentBoxItemsCount" variant="info" />
          <span class="text-slate-100 font-medium">{{ boxesStore.currentBox?.name || 'Микс не выбран' }}</span>
        </div>
      </div>

      <div v-if="!boxesStore.currentBox && activeBoxes.length === 0" class="absolute inset-0 flex flex-col items-center justify-center">
        <button class="w-20 h-20 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 flex items-center justify-center transition-colors shadow-lg shadow-blue-600/30" @click="createAndSelectNewBox()">
          <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <p class="mt-4 text-slate-400 text-sm">Создайте микс для начала работы</p>
      </div>

      <div v-if="!boxesStore.currentBox && activeBoxes.length > 0" class="flex flex-col items-center justify-center py-8">
        <button class="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 flex items-center justify-center transition-colors shadow-lg shadow-blue-600/30" @click="createAndSelectNewBox()">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <p class="mt-3 text-slate-400 text-sm">Создайте микс для начала работы</p>
      </div>

      <div v-if="!boxesStore.currentBox && activeBoxes.length > 0" class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <h3 class="font-semibold text-slate-100 mb-3">Или выберите существующий</h3>
        <div class="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
          <div v-for="box in activeBoxes" :key="'b' + box.id" class="item-row p-3 rounded-xl bg-slate-700/80 hover:bg-slate-600 cursor-pointer transition-colors" @click="selectBox(box)">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-slate-100">{{ box.name || 'Микс' }}</span>
              <span class="text-xs text-slate-400">Собиратель: {{ box.collector_id }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="boxesStore.currentBox" class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <h3 class="font-semibold text-slate-100 mb-3 flex items-center gap-2"><van-icon name="scan" class="text-primary-400" /> Сканирование</h3>

        <div class="mode-switcher mb-4">
          <div class="grid grid-cols-2 gap-3">
            <button :class="['py-3.5 rounded-xl text-base font-semibold transition-all duration-200 border-none cursor-pointer flex items-center justify-center gap-2', sc.scanMode.value === 'tsd' ? 'bg-gradient-to-r from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-500/30' : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700']" @click="sc.scanMode.value = 'tsd'">
              <img src="/img/bank-terminal.svg" alt="ТСД" class="w-5 h-5" /> ТСД
            </button>
            <button :class="['py-3.5 rounded-xl text-base font-semibold transition-all duration-200 border-none cursor-pointer flex items-center justify-center gap-2', sc.scanMode.value === 'camera' ? 'bg-gradient-to-r from-purple-500 to-purple-700 text-white shadow-lg shadow-purple-500/30' : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700']" @click="sc.scanMode.value = 'camera'">
              <img src="/img/camera-svg.svg" alt="Камера" class="w-5 h-5" /> Камера
            </button>
          </div>
        </div>

        <div v-if="sc.scanMode.value === 'tsd'" class="space-y-3 mt-4">
          <Input v-model="sc.tsdInput.value" placeholder="📱 Введите штрихкод и нажмите Enter" :disabled="sc.isProcessingTsd.value" variant="primary" size="large" @keyup.enter="sc.handleTsdInput(processScannedCode)" />
          <p class="text-xs text-slate-400 mt-1 ml-2">💡 Введите номер товара (например 45328) — префикс добавится автоматически</p>
        </div>

        <div v-if="sc.scanMode.value === 'camera'" class="space-y-3">
          <Button variant="primary" block @click="sc.isScanning.value ? sc.stopScanner() : startScanner()">
            <van-icon :name="sc.isScanning.value ? 'stop-circle-o' : 'scan'" size="20" />
            {{ sc.isScanning.value ? 'Сканирование...' : 'Старт' }}
          </Button>
          <p class="text-sm text-slate-500 mt-3 text-center">📷 Нажмите «Старт» для сканирования одного кода</p>
        </div>
      </div>

      <div v-if="boxesStore.currentBox" class="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden">
        <div class="p-4 border-b border-slate-700">
          <h3 class="font-semibold text-slate-100 flex items-center gap-2"><van-icon name="bag-o" class="text-primary-400" /> Товары в коробе ({{ boxesStore.currentBoxItemsCount }})</h3>
        </div>
        <div class="p-4 max-h-72 space-y-2 overflow-y-auto scrollbar-thin">
          <div v-if="boxesStore.currentBoxItemsCount === 0" class="text-center py-8">
            <div class="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-3"><van-icon name="bag-o" size="32" color="#64748b" /></div>
            <p class="text-slate-500 text-sm">Пока нет товаров. Отсканируйте штрихкод.</p>
          </div>
          <div v-for="(item, index) in boxesStore.currentBoxItemsReverse" :key="index" class="item-row p-3 rounded-xl transition-all duration-200 flex items-center gap-3" :class="boxesStore.lastScannedItem?.number === item.number ? 'bg-amber-500/20 border-2 border-amber-500' : 'bg-slate-700/50 hover:bg-slate-700'">
            <div class="w-8 h-8 rounded-lg bg-primary-500/20 border border-primary-500/30 flex items-center justify-center flex-shrink-0"><span class="text-xs font-bold text-primary-400">{{ index + 1 }}</span></div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-100 truncate">{{ item.name }}</p>
              <p class="text-xs text-slate-400 font-mono">{{ item.number }}</p>
              <p v-if="item.article" class="text-xs text-slate-500 mt-1">{{ item.article }}</p>
            </div>
            <button v-if="isContainerOwner" class="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center flex-shrink-0 hover:bg-red-500/40 transition-colors" @click="removeItem(item)"><van-icon name="delete-o" size="16" color="#ef4444" /></button>
          </div>
        </div>
      </div>

      <div v-if="boxesStore.currentBox && isContainerOwner" class="box-actions space-y-2">
        <div class="grid grid-cols-3 gap-2">
          <Button variant="secondary" :disabled="!boxesStore.canUndo" class="custom-btn-secondary" @click="performUndo()">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg> Отмена
          </Button>
          <Button variant="danger" class="custom-btn-danger" @click="cancelBox()">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> Сброс
          </Button>
          <Button variant="success" :disabled="boxesStore.currentBoxItemsCount === 0" :class="boxesStore.currentBoxItemsCount === 0 ? 'opacity-50' : ''" class="custom-btn-success" @click="finishBox()">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg> Готово
          </Button>
        </div>
      </div>
    </main>

    <Modal :model-value="showScanner" confirm-text="Стоп" confirm-color="danger" @update:model-value="(val) => { showScanner = val; if (!val) sc.stopScanner() }" @confirm="handleStopScanner">
      <div class="text-center mb-4">
        <h3 class="font-semibold text-slate-100 mb-1">📷 Сканирование штрихкода</h3>
        <p class="text-sm text-slate-400">Наведите камеру на штрихкод</p>
      </div>
      <div class="scanner-element rounded-2xl overflow-hidden mb-4 relative">
        <div :id="sc.scannerElementId" class="w-full"></div>
        <div class="scan-line"></div>
        <div class="scan-frame"></div>
      </div>
    </Modal>

    <Modal v-model="showStopItemModal" title="⛔ Стоп-товар!" :show-cancel="false" confirm-text="OK" @confirm="showStopItemModal = false">
      <div v-if="currentStopItem" class="text-left space-y-3">
        <div><p class="text-xs text-slate-400 mb-1">Наименование</p><p class="text-slate-100 font-medium">{{ currentStopItem.name }}</p></div>
        <div><p class="text-xs text-slate-400 mb-1">Номер</p><p class="text-slate-100 font-mono">{{ currentStopItem.number }}</p></div>
        <div><p class="text-xs text-slate-400 mb-1">Комментарий</p><p class="text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">{{ currentStopItem.comment || 'Нет комментария' }}</p></div>
        <p class="text-xs text-slate-500 mt-2">Этот товар нельзя отгружать в брак. Обратитесь к руководству для уточнения.</p>
      </div>
    </Modal>

    <Modal v-model="showRemoveModal" title="Удалить товар?" show-cancel confirm-text="Удалить" cancel-text="Отмена" confirm-color="danger" @confirm="confirmRemoveItem">
      <p class="text-slate-400 text-center">{{ removeItemRef?.name }} ({{ removeItemRef?.number }})</p>
    </Modal>

    <Modal v-model="showFinishModal" :title="'Завершить микс?'" show-cancel confirm-text="Да, завершить" cancel-text="Отмена" @confirm="confirmFinish()">
      <div class="text-left space-y-3 text-white">
        <p>Вы уверены что хотите завершить микс?</p>
        <div class="bg-slate-800/50 rounded-lg p-4">
          <p><strong>Микс:</strong> {{ boxesStore.currentBox?.name }}</p>
          <p><strong>Товаров:</strong> {{ boxesStore.currentBoxItemsCount }}</p>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.custom-btn-secondary { background: rgba(107, 114, 128, 0.2); border-color: rgba(107, 114, 128, 0.3); }
.custom-btn-danger { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-color: #dc2626; }
.custom-btn-success { background: linear-gradient(135deg, #10b981 0%, #059662 100%); border-color: #059662; }
.item-row:hover { transform: translateX(4px); }
.scrollbar-thin::-webkit-scrollbar { width: 4px; }
.scrollbar-thin::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); border-radius: 8px; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 8px; }
.mix-view { min-height: 100vh; }
main { flex: 1; }
.scanner-element { position: relative; min-height: 250px; background: #0f172a; }
.scan-frame { position: absolute; inset: 10%; border: 3px solid rgba(236, 72, 153, 0.8); border-radius: 16px; pointer-events: none; z-index: 10; box-shadow: 0 0 15px rgba(236, 72, 153, 0.3); }
.scan-line { position: absolute; left: 10%; right: 10%; height: 3px; background: linear-gradient(90deg, transparent, #ec4899, transparent); z-index: 11; animation: scan 2s ease-in-out infinite; box-shadow: 0 0 15px rgba(236, 72, 153, 0.6); }
@keyframes scan { 0%, 100% { top: 20%; } 50% { top: 78%; } }
</style>
