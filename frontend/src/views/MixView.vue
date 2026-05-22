<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBrainStore } from '@/stores/brain'
import { useBoxesStore } from '@/stores/boxes'
import { useCollectorStore } from '@/stores/collector'
import { useScanner } from '@/composables/useScanner'
import { parseBarcodeToBrainNumber, ensurePrefix } from '@/utils/barcode'
import { playSound } from '@/utils/sound'
import { db, ws } from '@/lib/api.js'
import ContainerView from '@/components/ContainerView.vue'

const router = useRouter()
const brainStore = useBrainStore()
const boxesStore = useBoxesStore()
const collectorStore = useCollectorStore()

const showScanner = ref(false)
const showStopItemModal = ref(false)
const currentStopItem = ref(null)
const showFinishModal = ref(false)
const showRemoveModal = ref(false)
const removeItemRef = ref(null)

const activeBoxes = ref([])
const _allActiveBoxes = ref([])
const isLoading = ref(false)

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
  await boxesStore.createBox()
  await loadActiveContainers()
  if (activeBoxes.value.length > 0) {
    const last = activeBoxes.value[activeBoxes.value.length - 1]
    selectBox(last)
  }
}

function mixItemHighlight(item) {
  if (boxesStore.lastScannedItem?.number === item.number) {
    return 'bg-amber-500/20 border-2 border-amber-500'
  }
  return 'bg-slate-700/50 hover:bg-slate-700'
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
      const collector = {
        fullName: collectorStore.fullName || '',
        position: collectorStore.position || ''
      }
      const result = await exportBoxToExcel(finishedBox, collector)
      if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
    } catch (err) {
      console.error('[MixView] exportBoxToExcel failed:', err)
    }
    await loadActiveContainers()
    if (!boxesStore.currentBox?.backendId || boxesStore.currentBox.status === 'finished') {
      boxesStore.currentBox = null
    }
  } else {
    window.showToast(` Ошибка завершения микса: ${boxesStore.syncError || 'неизвестная ошибка'}`)
  }
}

function cancelBox() {
  boxesStore.cancelCurrentBox()
}

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

const isContainerOwner = computed(() => {
  const container = boxesStore.currentBox
  if (!container?.collector_id) return true
  return container.collector_id === collectorStore.employeeId
})

const sc = useScanner({
  elementId: 'barcode-scanner',
  onScanSuccess: processScannedCode,
  onScanComplete: () => {
    showScanner.value = false
  }
})

onMounted(async () => {
  ws.on('box_created', boxCreatedHandler)
  ws.on('box_finished', boxFinishedHandler)
  if (navigator.onLine) {
    isLoading.value = true
    try {
      await loadActiveContainers()
    } finally {
      isLoading.value = false
    }
  }
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
  <ContainerView
    v-model:show-scanner="showScanner"
    :store="boxesStore"
    v-model:show-stop-item-modal="showStopItemModal"
    container-type="box"
    v-model:show-remove-modal="showRemoveModal"
    container-label="микс"
    v-model:show-finish-modal="showFinishModal"
    container-label-plural="миксы"
    nav-title="Миксы"
    :is-loading="isLoading"
    :right-text="activeBoxes.length > 0 ? 'Смотреть' : 'Результаты'"
    :right-route="
      activeBoxes.length > 0 ? { path: '/mix', query: { id: activeBoxes[0].id } } : '/boxes'
    "
    :active-containers="activeBoxes"
    :items="boxesStore.currentBoxItemsReverse"
    :current-stop-item="currentStopItem"
    :remove-item-ref="removeItemRef"
    :scanner="sc"
    :is-owner="isContainerOwner"
    :show-mixes-section="false"
    finish-modal-title="Завершить микс?"
    finish-modal-description="Вы уверены что хотите завершить микс?"
    :get-item-highlight="mixItemHighlight"
    @click-left="$router.back()"
    @click-right="
      activeBoxes.length > 0
        ? $router.push({ path: '/mix', query: { id: activeBoxes[0].id } })
        : $router.push('/boxes')
    "
    @create-container="createAndSelectNewBox"
    @select-container="selectBox"
    @start-scanner="startScanner"
    @stop-scanner="handleStopScanner"
    @finish="finishBox"
    @confirm-finish="confirmFinish"
    @cancel-container="cancelBox"
    @undo="performUndo"
    @remove-item="requestRemoveItem"
    @confirm-remove="confirmRemoveItem"
  />
</template>

<style scoped></style>
