<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBrainStore } from '@/stores/brain'
import { useBoxesStore } from '@/stores/boxes'
import { useCollectorStore } from '@/stores/collector'
import { usePalletStore } from '@/stores/pallet'
import { useScanner } from '@/composables/useScanner'
import { parseBarcodeToBrainNumber, ensurePrefix } from '@/utils/barcode'
import { playSound } from '@/utils/sound'
import { db, ws } from '@/lib/api.js'
import ContainerView from '@/components/ContainerView.vue'

const router = useRouter()
const brainStore = useBrainStore()
const boxesStore = useBoxesStore()
const collectorStore = useCollectorStore()
const palletStore = usePalletStore()

const _palletRefreshCounter = ref(0)

watch(
  () => palletStore.palletItemsVersion,
  (version) => {
    if (version !== undefined && version > _palletRefreshCounter.value) {
      _palletRefreshCounter.value = version
    }
  },
  { deep: true, immediate: false }
)

watch(
  () => palletStore.currentPallet?.items,
  (newItems, oldItems) => {
    if (newItems && newItems !== oldItems) {
      _palletRefreshCounter.value++
    }
  },
  { deep: true, immediate: false }
)

const palletItemsSimple = computed(() => {
  const _versionTrigger = _palletRefreshCounter.value
  if (!palletStore.currentPallet?.items) return []
  const items = palletStore.currentPallet.items || []
  const _versionCheck = palletStore.palletItemsVersion
  return [...items].reverse()
})

const palletItemsWithDetails = computed(() => {
  const simpleItems = palletItemsSimple.value
  if (!simpleItems || simpleItems.length === 0) return []

  const result = []
  for (const ref of simpleItems) {
    if (ref.source_type === 'pallet' || ref.source_type === 'inline') {
      let data = {
        number: ref.barcode || String(ref.source_id) || '',
        name: ref.name || `Товар ${ref.barcode || ''}`,
        article: ref.article || '',
        comment: ref.comment || ''
      }
      if (!data.number && data.name.startsWith('Товар 1')) continue
      if (!data.name || data.name.startsWith('Товар') || !ref.name) {
        const found = brainStore.findByBarcode(data.number)
        if (found && found.name) {
          data.name = found.name
          if (!data.article && found.article) data.article = found.article
        } else {
          const parsedNum = parseBarcodeToBrainNumber(data.number)
          if (parsedNum !== data.number) {
            const found2 = brainStore.findByBarcode(parsedNum)
            if (found2 && found2.name) data.name = found2.name
          }
        }
      }
      result.push({ ...data, source_id: ref.source_id, source_type: ref.source_type })
    } else if (ref.source_type === 'separate_item') {
      let data = ref._full_data
      if (!data && ref.name) {
        data = {
          number: ref.barcode || '',
          name: ref.name || 'Товар',
          article: ref.article || ref.brand || '',
          comment: ref.comment || ''
        }
      }
      if (!data) {
        const found = palletStore.availableSeparateItems.find((i) => i.id === ref.source_id)
        if (found) {
          data = {
            number: found.barcode,
            name: found.name,
            article: found.brand || '',
            comment: found.comment || ''
          }
        }
      }
      if (!data) data = { number: String(ref.source_id), name: 'Товар', article: '' }
      result.push({ ...data, source_id: ref.source_id, source_type: ref.source_type })
    } else if (ref.source_type === 'box') {
      const box = palletStore.availableBoxes.find((b) => b.id === ref.source_id)
      if (box) {
        result.push({
          number: `Микс #${box.number}`,
          name: `${box.name} (${box.itemCount || 0} товаров)`,
          article: '',
          comment: 'Готовый микс',
          isBoxRef: true,
          source_id: ref.source_id,
          source_type: 'box'
        })
      } else if (ref._boxNumber || ref._boxName) {
        result.push({
          number: `Микс #${ref._boxNumber || ref.source_id}`,
          name: `${ref._boxName || 'Микс'} (${ref._boxItemCount || 0} товаров)`,
          article: '',
          comment: 'Готовый микс',
          isBoxRef: true,
          source_id: ref.source_id,
          source_type: 'box'
        })
      }
    }
  }
  return result
})

function palletItemHighlight(item, index) {
  if (index === 0)
    return 'bg-emerald-500/15 border-2 border-emerald-400 item-new-glow overflow-visible'
  return 'bg-slate-700/80 hover:bg-slate-600'
}

const showScanner = ref(false)
const showStopItemModal = ref(false)
const currentStopItem = ref(null)
const showFinishModal = ref(false)
const showRemoveModal = ref(false)
const removeItemRef = ref(null)

const activePallets = ref([])
const _allActivePallets = ref([])
let allPalletsGlobal = []
const isLoading = ref(false)

const availableMixes = ref([])
const isLoadingMixes = ref(false)

async function loadAvailableMixes() {
  isLoadingMixes.value = true
  try {
    const result = await db.boxes.getAll()
    if (result?.data) {
      const boxes = (result.data || []).filter((b) => b.status === 'finished')
      const usedBoxIds = new Set()
      if (palletStore.currentPallet?.items) {
        for (const item of palletStore.currentPallet.items) {
          if (item.source_type === 'box') usedBoxIds.add(item.source_id)
        }
      }
      availableMixes.value = await Promise.all(
        boxes
          .filter((b) => !usedBoxIds.has(b.id))
          .map(async (box) => {
            let itemCount = 0
            try {
              const itemsResult = await db.boxItems.getByBoxId(box.id)
              itemCount = (itemsResult?.data || []).length
            } catch (err) {
              console.error('[PalletView] failed to load box items for box', box.id, err)
            }
            return {
              id: box.id,
              number: box.box_number || 0,
              name: box.name || `Микс ${box.box_number}`,
              itemCount,
              createdAt: box.created_at
            }
          })
      )
    }
  } catch (err) {
  } finally {
    isLoadingMixes.value = false
  }
}

async function addMixToPallet(box) {
  const result = await palletStore.addBoxToPallet(box)
  if (result === true) {
    window.showToast(`✅ Микс #${box.number} добавлен в паллет`, 2000, 'success')
    availableMixes.value = availableMixes.value.filter((m) => m.id !== box.id)
  } else if (result?.error === 'duplicate_in_active_pallet') {
    window.showToast(`⚠️ ${result.message}`, 3000, 'warning')
    availableMixes.value = availableMixes.value.filter((m) => m.id !== box.id)
  } else if (result?.error === 'duplicate') {
    window.showToast(`️ Микс #${box.number} уже в паллете`, 2000, 'error')
    availableMixes.value = availableMixes.value.filter((m) => m.id !== box.id)
  } else {
    window.showToast('⚠️ Не удалось добавить микс', 2000, 'error')
  }
}

function palletCreatedHandler(msg) {
  if (msg.pallet_id && !_allActivePallets.value.find((p) => p.id === msg.pallet_id)) {
    const newPallet = { id: msg.pallet_id, collector_id: msg.collector_id }
    if (msg.collector_id === collectorStore.employeeId) activePallets.value.push(newPallet)
    _allActivePallets.value.push(newPallet)
  }
}

async function loadActiveContainers() {
  if (!navigator.onLine) return
  await boxesStore.loadAllActiveBoxes()
  const allPallets = (await palletStore.loadAllActivePallets()) || []
  activePallets.value = allPallets.filter((p) => p.collector_id === collectorStore.employeeId)
  allPalletsGlobal = allPallets
}

function selectPallet(pallet) {
  palletStore.currentPallet = pallet
  window.showToast(`Открыт паллет ${pallet.name || ''}`, 2000, 'default')
}

async function createAndSelectNewPallet() {
  await palletStore.createPallet()
  await loadActiveContainers()
  if (activePallets.value.length > 0) {
    const last = activePallets.value[activePallets.value.length - 1]
    palletStore.currentPallet = await palletStore.loadActivePalletById(last, allPalletsGlobal)
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

  const duplicateInOthers = await palletStore.checkGlobalDuplicate(normalizedBarcode)
  if (duplicateInOthers) {
    const containerType = duplicateInOthers.type === 'box' ? 'миксе' : 'паллете'
    window.showToast(`️ Товар уже в ${containerType} №${duplicateInOthers.boxNumber}`, 5000, 'error')
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    playSound('error')
    return null
  }

  const scannedAt = new Date().toISOString()
  const itemData = item
    ? {
        number: normalizedBarcode,
        name: item.name,
        article: item.article,
        comment: item.comment,
        scannedAt
      }
    : { number: normalizedBarcode, name: `Товар ${normalizedBarcode}`, scannedAt }
  const result = await palletStore.addInlineItemToPallet(itemData)
  if (result?.success) {
    window.showToast(`✅ Товар добавлен`, 1000, 'success')
    return { name: item?.name || `Товар ${normalizedBarcode}`, barcode }
  } else {
    window.showToast(`️ Не удалось добавить товар`, 3000, 'error')
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

async function finishPallet() {
  if (!palletStore.currentPallet || (palletStore.currentPallet.items || []).length === 0) {
    window.showToast('Паллет пуст')
    return
  }
  showFinishModal.value = true
}

async function confirmFinish() {
  showFinishModal.value = false
  const finishedPallet = await palletStore.finishCurrentPallet()
  if (finishedPallet) {
    window.showToast(`✅ Паллет ${finishedPallet.name} завершён. Пломба: ${finishedPallet.seal}`)
    try {
      const { exportPalletToExcel } = await import('@/utils/excel')
      const result = await exportPalletToExcel(finishedPallet, {
        fullName: collectorStore.fullName || '',
        position: collectorStore.position || ''
      })
      if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
    } catch (err) {
      console.error('[PalletView] exportPalletToExcel failed:', err)
    }
    loadActiveContainers()
  } else {
    window.showToast('❌ Ошибка завершения паллета')
  }
}

async function cancelPallet() {
  await palletStore.cancelCurrentPallet()
  activePallets.value = []
  _allActivePallets.value = []
}

async function performUndo() {
  const undoneItem = await palletStore.undoLastAction()
  if (undoneItem) {
    playSound('undo')
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    window.showToast(`Отменено: ${undoneItem.name || undoneItem.number}`, 2000, 'default')
  } else {
    window.showToast('Нечего отменять', 1500, 'error')
  }
}

async function refreshPalletItems() {
  if (!palletStore.currentPallet?.backendId) {
    window.showToast('Нет текущего паллета', 1500)
    return
  }
  try {
    const itemsResult = await db.palletItems.getByPalletId(palletStore.currentPallet.backendId)
    if (itemsResult?.data) {
      const boxRefs = itemsResult.data.filter((i) => i.source_type === 'box')
      const otherRefs = itemsResult.data.filter((i) => i.source_type !== 'box')
      const serverItems = []
      for (const boxRef of boxRefs) {
        try {
          const boxResult = await db.boxes.getById(boxRef.source_id)
          if (boxResult?.data) {
            const boxItemsResult = await db.boxItems.getByBoxId(boxRef.source_id)
            const boxItemsList = boxItemsResult?.data || []
            serverItems.push({
              source_type: 'box',
              source_id: boxRef.source_id,
              order_num: boxResult.data.box_number || 0,
              _full_data: boxItemsList.length > 0 ? { items: boxItemsList } : null,
              _undoId: crypto.randomUUID ? crypto.randomUUID() : `undo-${Date.now()}`,
              _boxNumber: boxResult.data.box_number || 0,
              _boxName: boxResult.data.name || `Микс ${boxResult.data.box_number}`,
              _boxItemCount: boxItemsList.length
            })
          }
        } catch (err) {
          console.error('[PalletView] failed to load box items for enrichment:', err)
        }
      }
      serverItems.push(
        ...otherRefs
          .map((i) => ({
            source_type:
              i.source_type === 'pallet' || i.source_type === 'inline' ? 'pallet' : i.source_type,
            source_id: i.source_id,
            barcode: i.item_barcode || '',
            name: i.item_name && i.item_name.trim() ? i.item_name : `Товар ${i.source_id}`,
            article: i.item_brand && i.item_brand.trim() ? i.item_brand : '',
            comment: i.item_comment && i.item_comment.trim() ? i.item_comment : '',
            scannedAt: i.scanned_at || ''
          }))
          .filter(Boolean)
      )
      palletStore.currentPallet = { ...palletStore.currentPallet, items: serverItems }
      palletStore.triggerPalletItemsUpdate()
      window.showToast('Обновлено', 1500)
    }
  } catch (err) {
    window.showToast('Ошибка обновления', 2000, 'error')
  }
}

function requestRemoveItem(item) {
  removeItemRef.value = item
  showRemoveModal.value = true
}

async function confirmRemoveItem() {
  if (removeItemRef.value) {
    await palletStore.removeItemFromPallet(removeItemRef.value)
    window.showToast('Товар удалён')
    if (removeItemRef.value.source_type === 'box') await loadAvailableMixes()
  }
  showRemoveModal.value = false
  removeItemRef.value = null
}

const isContainerOwner = computed(() => {
  const container = palletStore.currentPallet
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
  ws.on('pallet_created', palletCreatedHandler)
  const hadExistingPallet = !!palletStore.currentPallet?.backendId
  if (navigator.onLine && !hadExistingPallet) {
    isLoading.value = true
    try {
      await loadActiveContainers()
    } finally {
      isLoading.value = false
    }
  }
  if (!hadExistingPallet && activePallets.value.length > 0 && !palletStore.currentPallet) {
    const myPallet = activePallets.value.find((p) => p.collector_id === collectorStore.employeeId)
    if (myPallet) {
      const last = activePallets.value[activePallets.value.length - 1]
      palletStore.currentPallet = await palletStore.loadActivePalletById(last, allPalletsGlobal)
    }
  } else if (hadExistingPallet && navigator.onLine) {
    const result = await db.pallets.getAll()
    if (result?.data) {
      allPalletsGlobal = result.data
      const { useCollectorStore } = await import('@/stores/collector')
      const collectorStore = useCollectorStore()
      activePallets.value = (result.data || []).filter(
        (p) => p.status === 'active' && p.collector_id === collectorStore.employeeId
      )
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  loadAvailableMixes()
})

onUnmounted(() => {
  ws.off('pallet_created', palletCreatedHandler)
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
    :store="palletStore"
    container-type="pallet"
    container-label="паллет"
    container-label-plural="паллеты"
    nav-title="Паллеты"
    :is-loading="isLoading"
    :right-text="activePallets.length > 0 ? 'Смотреть' : 'Результаты'"
    :right-route="{ path: '/pallet', query: { id: activePallets[0]?.id } }"
    :active-containers="activePallets"
    :items="palletItemsWithDetails"
    :current-stop-item="currentStopItem"
    :remove-item-ref="removeItemRef"
    :scanner="sc"
    :is-owner="isContainerOwner"
    :show-mixes-section="true"
    :available-mixes="availableMixes"
    :is-loading-mixes="isLoadingMixes"
    finish-modal-title="Завершить паллет?"
    finish-modal-description="Вы уверены что хотите завершить паллет?"
    :get-item-highlight="palletItemHighlight"
    @click-left="$router.back()"
    @click-right="
      activePallets.length > 0
        ? $router.push({ path: '/pallet', query: { id: activePallets[0].id } })
        : $router.push('/boxes')
    "
    @create-container="createAndSelectNewPallet"
    @select-container="selectPallet"
    @start-scanner="startScanner"
    @stop-scanner="handleStopScanner"
    @finish="finishPallet"
    @confirm-finish="confirmFinish"
    @cancel-container="cancelPallet"
    @undo="performUndo"
    @remove-item="requestRemoveItem"
    @confirm-remove="confirmRemoveItem"
    @load-mixes="loadAvailableMixes"
    @add-mix="addMixToPallet"
    @refresh-items="refreshPalletItems"
  />
</template>

<style scoped>
.item-new-glow {
  position: relative;
}
.item-new-glow::after {
  content: 'NEW';
  position: absolute;
  top: 4px;
  right: 12px;
  z-index: 10;
  animation: badgePulse 1.5s ease-in-out infinite;
  background: #10b981;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1.4;
}
@keyframes badgePulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
</style>
