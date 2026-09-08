<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useBrainStore } from '@/stores/brain'
import { useBoxesStore } from '@/stores/boxes'
import { useScanner } from '@/composables/useScanner'
import { parseBarcodeToBrainNumber, ensurePrefix } from '@/utils/barcode'
import { playSound } from '@/utils/sound'
import ContainerView from '@/components/ContainerView.vue'

const brainStore = useBrainStore()
const boxesStore = useBoxesStore()

const showScanner = ref(false)
const showStopItemModal = ref(false)
const currentStopItem = ref(null)
const showFinishModal = ref(false)
const showCancelModal = ref(false)
const showRemoveModal = ref(false)
const removeItemRef = ref(null)

const activeBoxes = ref([])
const _allActiveBoxes = ref([])
const isLoading = ref(false)

async function loadActiveContainers() {
  const allBoxes = (await boxesStore.loadAllActiveBoxes()) || []
  activeBoxes.value = allBoxes
  _allActiveBoxes.value = allBoxes
}

function selectBox(box) {
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

  const duplicateInOthers = await boxesStore.checkGlobalDuplicate(normalizedBarcode)
  if (duplicateInOthers) {
    const containerType = duplicateInOthers.type === 'pallet' ? 'паллете' : 'миксе'
    window.showToast(`️ Товар уже в ${containerType} №${duplicateInOthers.boxNumber}`, 5000, 'error')
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    playSound('error')
    return null
  }

  const result = await boxesStore.addItemToCurrentBox(
    item || { number: normalizedBarcode, name: `Товар ${normalizedBarcode}` }
  )
  if (result.success) {
    window.showToast(`✅ Товар добавлен`, 1000, 'success')
    sc.tsdInput.value = ''
    return { name: item?.name || `Товар ${normalizedBarcode}`, barcode }
  } else {
    if (result.error === 'duplicate_global') {
      const containerType = result.containerType === 'pallet' ? 'паллете' : 'миксе'
      window.showToast(`️ Товар уже в ${containerType} №${result.boxNumber}`, 5000, 'error')
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
  console.warn('[FINISH.DIAG] confirmFinish result', {
    hasBox: !!finishedBox,
    syncError: boxesStore.syncError
  })
  if (finishedBox) {
    window.showToast(`✅ Микс ${finishedBox.name} завершён. Пломба: ${finishedBox.seal}`)
    try {
      const { exportBoxToExcel } = await import('@/utils/excel')
      const result = await exportBoxToExcel(finishedBox)
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
  const count = boxesStore.currentBox?.items?.length || 0
  if (count === 0) {
    window.showToast('Микс уже пуст', 1500, 'default')
    return
  }
  showCancelModal.value = true
}

async function confirmCancel() {
  const result = await boxesStore.cancelCurrentBox()
  window.showToast(`Микс очищен (удалено: ${result?.cleared ?? 0})`)
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

const sc = useScanner({
  elementId: 'barcode-scanner',
  onScanSuccess: processScannedCode,
  onScanComplete: () => {
    showScanner.value = false
  }
})

onMounted(async () => {
  isLoading.value = true
  try {
    await loadActiveContainers()
  } finally {
    isLoading.value = false
  }
  if (activeBoxes.value.length > 0 && !boxesStore.currentBox) {
    boxesStore.currentBox = activeBoxes.value[0]
  }
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
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
    v-model:show-stop-item-modal="showStopItemModal"
    v-model:show-remove-modal="showRemoveModal"
    v-model:show-finish-modal="showFinishModal"
    :store="boxesStore"
    container-type="box"
    container-label="микс"
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
    :on-tsd-submit="processScannedCode"
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

  <Modal
    v-model="showCancelModal"
    title="Сбросить микс?"
    show-cancel
    confirm-text="Да, сбросить"
    cancel-text="Отмена"
    confirm-color="danger"
    @confirm="confirmCancel"
  >
    <p class="text-slate-400 text-center">
      Будет удалён {{ boxesStore.currentBoxItemsCount }} товар(а) из текущего микса. Действие нельзя
      отменить.
    </p>
  </Modal>
</template>

<style scoped></style>
