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
import { Button, Input, Badge, NavBar, Modal } from '@/components/ui'
import { db, ws } from '@/lib/api.js'

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
          data = { number: found.barcode, name: found.name, article: found.brand || '', comment: found.comment || '' }
        }
      }
      if (!data) data = { number: String(ref.source_id), name: 'Товар', article: '' }
      result.push({ ...data, source_id: ref.source_id, source_type: ref.source_type })
    } else if (ref.source_type === 'box') {
      const box = palletStore.availableBoxes.find((b) => b.id === ref.source_id)
      if (box) {
        result.push({
          number: `Микс #${box.number}`, name: `${box.name} (${box.itemCount || 0} товаров)`,
          article: '', comment: 'Готовый микс', isBoxRef: true, source_id: ref.source_id, source_type: 'box'
        })
      } else if (ref._boxNumber || ref._boxName) {
        result.push({
          number: `Микс #${ref._boxNumber || ref.source_id}`, name: `${ref._boxName || 'Микс'} (${ref._boxItemCount || 0} товаров)`,
          article: '', comment: 'Готовый микс', isBoxRef: true, source_id: ref.source_id, source_type: 'box'
        })
      }
    }
  }
  return result
})

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
    await palletStore.removeItemFromPallet(removeItemRef.value)
    window.showToast('Товар удалён')
    if (removeItemRef.value.source_type === 'box') await loadAvailableMixes()
  }
  showRemoveModal.value = false
  removeItemRef.value = null
}

const activePallets = ref([])
const _allActivePallets = ref([])
let allPalletsGlobal = []

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
        boxes.filter((b) => !usedBoxIds.has(b.id)).map(async (box) => {
          let itemCount = 0
          try {
            const itemsResult = await db.boxItems.getByBoxId(box.id)
            itemCount = (itemsResult?.data || []).length
          } catch {}
          return { id: box.id, number: box.box_number || 0, name: box.name || `Микс ${box.box_number}`, itemCount, createdAt: box.created_at }
        })
      )
    }
  } catch (err) {} finally { isLoadingMixes.value = false }
}

async function addMixToPallet(box) {
  const result = await palletStore.addBoxToPallet(box)
  if (result === true) {
    window.showToast(`✅ Микс #${box.number} добавлен в паллет`, 2000, 'success')
    availableMixes.value = availableMixes.value.filter((m) => m.id !== box.id)
  } else if (result?.error === 'duplicate') {
    window.showToast(`⚠️ Микс #${box.number} уже в паллете`, 2000, 'error')
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
    ? { number: normalizedBarcode, name: item.name, article: item.article, comment: item.comment, scannedAt }
    : { number: normalizedBarcode, name: `Товар ${normalizedBarcode}`, scannedAt }
  const result = await palletStore.addInlineItemToPallet(itemData)
  if (result.success) {
    window.showToast(`✅ Товар добавлен`, 1000, 'success')
    nextTick(() => {})
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
      const result = await exportPalletToExcel(finishedPallet, { fullName: collectorStore.fullName || '', position: collectorStore.position || '' })
      if (result.success) window.showToast(`Файл скачан: ${result.filename}`)
    } catch {}
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
              source_type: 'box', source_id: boxRef.source_id, order_num: boxResult.data.box_number || 0,
              _full_data: boxItemsList.length > 0 ? { items: boxItemsList } : null,
              _undoId: crypto.randomUUID ? crypto.randomUUID() : `undo-${Date.now()}`,
              _boxNumber: boxResult.data.box_number || 0, _boxName: boxResult.data.name || `Микс ${boxResult.data.box_number}`,
              _boxItemCount: boxItemsList.length
            })
          }
        } catch {}
      }
      serverItems.push(...otherRefs.map((i) => ({
        source_type: i.source_type === 'pallet' || i.source_type === 'inline' ? 'pallet' : i.source_type,
        source_id: i.source_id, barcode: i.item_barcode || '',
        name: i.item_name && i.item_name.trim() ? i.item_name : `Товар ${i.source_id}`,
        article: i.item_brand && i.item_brand.trim() ? i.item_brand : '',
        comment: i.item_comment && i.item_comment.trim() ? i.item_comment : '', scannedAt: i.scanned_at || ''
      })).filter(Boolean))
      palletStore.currentPallet = { ...palletStore.currentPallet, items: serverItems }
      palletStore.triggerPalletItemsUpdate()
      window.showToast('Обновлено', 1500)
    }
  } catch (err) {
    window.showToast('Ошибка обновления', 2000, 'error')
  }
}

function removeItem(item) { requestRemoveItem(item) }

const isContainerOwner = computed(() => {
  const container = palletStore.currentPallet
  if (!container?.collector_id) return true
  return container.collector_id === collectorStore.employeeId
})

const sc = useScanner({
  elementId: 'barcode-scanner',
  onScanSuccess: processScannedCode
})

onMounted(async () => {
  ws.on('pallet_created', palletCreatedHandler)
  const hadExistingPallet = !!palletStore.currentPallet?.backendId
  if (navigator.onLine && !hadExistingPallet) await loadActiveContainers()
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
      activePallets.value = (result.data || []).filter((p) => p.status === 'active' && p.collector_id === collectorStore.employeeId)
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
  <div class="pallet-view min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pb-20">
    <NavBar
      title="Паллеты"
      left-text="Назад"
      left-arrow
      :right-text="activePallets.length > 0 ? 'Смотреть' : 'Результаты'"
      @click-left="$router.back()"
      @click-right="
        activePallets.length > 0
          ? $router.push({ path: '/pallet', query: { id: activePallets[0].id } })
          : $router.push('/boxes')
      "
    />

    <main class="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
      <div v-if="palletStore.currentPallet" class="status-bar bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-center">
        <div class="flex items-center justify-center gap-3 mb-2">
          <Badge :count="palletStore.currentPallet?.items?.length || 0" variant="info" />
          <span class="text-slate-100 font-medium">{{ palletStore.currentPallet?.name || 'Паллет не выбран' }}</span>
        </div>
      </div>

      <div v-if="!palletStore.currentPallet && activePallets.length === 0" class="absolute inset-0 flex flex-col items-center justify-center">
        <button class="w-20 h-20 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 flex items-center justify-center transition-colors shadow-lg shadow-blue-600/30" @click="createAndSelectNewPallet()">
          <svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <p class="mt-4 text-slate-400 text-sm">Создайте паллет для начала работы</p>
      </div>

      <div v-if="!palletStore.currentPallet && activePallets.length > 0" class="flex flex-col items-center justify-center py-8">
        <button class="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 flex items-center justify-center transition-colors shadow-lg shadow-blue-600/30" @click="createAndSelectNewPallet()">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <p class="mt-3 text-slate-400 text-sm">Создайте паллет для начала работы</p>
      </div>

      <div v-if="!palletStore.currentPallet && activePallets.length > 0" class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <h3 class="font-semibold text-slate-100 mb-3">Или выберите существующий</h3>
        <div class="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
          <div v-for="pallet in activePallets" :key="'p' + pallet.id" class="item-row p-3 rounded-xl bg-slate-700/80 hover:bg-slate-600 cursor-pointer transition-colors" @click="selectPallet(pallet)">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-slate-100">{{ pallet.name || 'Паллет' }}</span>
              <span class="text-xs text-slate-400">Собиратель: {{ pallet.collector_id }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="palletStore.currentPallet" class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <h3 class="font-semibold text-slate-100 mb-3 flex items-center gap-2">
          <van-icon name="scan" class="text-primary-400" /> Сканирование
        </h3>

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

      <div v-if="palletStore.currentPallet && isContainerOwner" class="mt-4">
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden">
          <div class="p-4 border-b border-slate-700 flex items-center justify-between">
            <h3 class="font-semibold text-slate-100 flex items-center gap-2"><van-icon name="bag" class="text-primary-400" /> Готовые миксы</h3>
            <button class="text-primary-400 text-sm flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors" @click="loadAvailableMixes"><van-icon name="replay" size="14" /> Обновить</button>
          </div>
          <div class="p-4">
            <div v-if="isLoadingMixes" class="text-center py-6"><p class="text-slate-400 text-sm">Загрузка...</p></div>
            <div v-else-if="availableMixes.length === 0" class="text-center py-6"><p class="text-slate-500 text-sm">Нет завершённых миксов</p></div>
            <div v-else class="space-y-2 max-h-64 overflow-y-auto">
              <div v-for="mix in availableMixes" :key="mix.id" class="flex items-center justify-between p-3 bg-slate-700/80 rounded-xl">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-100 truncate">Микс #{{ mix.number }}</p>
                  <p class="text-xs text-slate-400">{{ mix.name }}</p>
                </div>
                <button class="ml-3 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0" @click="addMixToPallet(mix)">+ Добавить</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="palletStore.currentPallet" class="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden">
        <div class="p-4 border-b border-slate-700 flex items-center justify-between">
          <h3 class="font-semibold text-slate-100 flex items-center gap-2"><van-icon name="bag-o" class="text-primary-400" /> Товары в паллете ({{ palletStore.currentPallet?.items?.length || 0 }})</h3>
          <button class="text-primary-400 text-sm flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors" @click="refreshPalletItems"><van-icon name="replay" size="14" /> Обновить</button>
        </div>
        <div class="p-4">
          <div v-if="palletItemsWithDetails.length === 0" class="text-center py-8">
            <div class="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-3"><van-icon name="bag-o" size="32" color="#64748b" /></div>
            <p class="text-slate-500 text-sm">Пока нет товаров. Отсканируйте штрихкод.</p>
          </div>
          <div v-else class="items-list-detail space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
            <div v-for="(item, index) in palletItemsWithDetails" :key="index" class="item-row p-3 rounded-xl transition-all duration-200 relative" :class="index === 0 ? 'bg-emerald-500/15 border-2 border-emerald-400 item-new-glow overflow-visible' : 'bg-slate-700/80 hover:bg-slate-600'">
              <div v-if="index === 0" class="new-badge absolute top-[4px] right-3 z-10">NEW</div>
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0"><span class="text-xs font-bold text-emerald-400">{{ index + 1 }}</span></div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-100 truncate mb-1">{{ item.name }}</p>
                  <p class="text-xs text-slate-400 font-mono">{{ item.number || '—' }}</p>
                  <p v-if="item.article" class="text-xs text-slate-500 mt-1">{{ item.article }}</p>
                </div>
                <button v-if="isContainerOwner" class="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center flex-shrink-0 hover:bg-red-500/40 transition-colors" @click="removeItem(item)"><van-icon name="delete-o" size="16" color="#ef4444" /></button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="palletStore.currentPallet && isContainerOwner" class="box-actions space-y-2">
        <div class="grid grid-cols-3 gap-2">
          <Button variant="secondary" :disabled="!palletStore.canUndo" class="custom-btn-secondary" @click="performUndo()">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg> Отмена
          </Button>
          <Button variant="danger" class="custom-btn-danger" @click="cancelPallet()">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> Сброс
          </Button>
          <Button variant="success" :disabled="(palletStore.currentPallet?.items || []).length === 0" :class="(palletStore.currentPallet?.items || []).length === 0 ? 'opacity-50' : ''" class="custom-btn-success" @click="finishPallet()">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg> Завершить паллет
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

    <Modal v-model="showFinishModal" :title="'Завершить паллет?'" show-cancel confirm-text="Да, завершить" cancel-text="Отмена" @confirm="confirmFinish()">
      <div class="text-left space-y-3 text-white">
        <p>Вы уверены что хотите завершить паллет?</p>
        <div class="bg-slate-800/50 rounded-lg p-4">
          <p><strong>Паллет:</strong> {{ palletStore.currentPallet?.name }}</p>
          <p><strong>Товаров:</strong> {{ palletStore.currentPallet?.items?.length }}</p>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.custom-btn-secondary { background: rgba(107, 114, 128, 0.2); border-color: rgba(107, 114, 128, 0.3); }
.custom-btn-danger { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-color: #dc2626; }
.custom-btn-success { background: linear-gradient(135deg, #10b981 0%, #059652 100%); border-color: #059652; }
.item-row:hover { transform: translateX(4px); }
.new-badge { animation: badgePulse 1.5s ease-in-out infinite; background: #10b981; color: #fff; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; line-height: 1.4; }
@keyframes badgePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
.scrollbar-thin::-webkit-scrollbar { width: 4px; }
.scrollbar-thin::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); border-radius: 8px; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 8px; }
.pallet-view { min-height: 100vh; }
main { flex: 1; }
.scanner-element { position: relative; min-height: 250px; background: #0f172a; }
.scan-frame { position: absolute; inset: 10%; border: 3px solid rgba(236, 72, 153, 0.8); border-radius: 16px; pointer-events: none; z-index: 10; box-shadow: 0 0 15px rgba(236, 72, 153, 0.3); }
.scan-line { position: absolute; left: 10%; right: 10%; height: 3px; background: linear-gradient(90deg, transparent, #ec4899, transparent); z-index: 11; animation: scan 2s ease-in-out infinite; box-shadow: 0 0 15px rgba(236, 72, 153, 0.6); }
@keyframes scan { 0%, 100% { top: 20%; } 50% { top: 78%; } }
</style>
