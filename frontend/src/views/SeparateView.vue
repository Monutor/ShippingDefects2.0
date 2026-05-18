<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBrainStore } from '@/stores/brain'
import { useSeparateStore } from '@/stores/separate'
import { useCollectorStore } from '@/stores/collector'
import { createScanner, checkCameraSupport } from '@/utils/scanner'
import { parseBarcodeToBrainNumber, ensurePrefix } from '@/utils/barcode'
import { initSounds, playSound } from '@/utils/sound'
import { exportSeparateToExcel } from '@/utils/excel'
import { Button, Input, Badge, NavBar, Modal, Loader } from '@/components/ui'

const router = useRouter()
const brainStore = useBrainStore()
const separateStore = useSeparateStore()
const collectorStore = useCollectorStore()

window.isProcessingStopItem = false

const scanMode = ref('camera')
const tsdInput = ref('')
const isProcessingTsd = ref(false)

const showScanner = ref(false)
const isScanning = ref(false)
const scannerElementId = 'barcode-scanner'
let scanner = null

const showStopItemModal = ref(false)
const currentStopItem = ref(null)
const showDuplicateModal = ref(false)
const currentDuplicateItem = ref(null)

function handleKeyDown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
    event.preventDefault()
    performUndo()
  }
}

async function performUndo() {
  const undoneItem = await separateStore.undoLastAction()
  if (undoneItem) {
    playSound('undo')
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    window.showToast(`↩ Отменено: ${undoneItem.name}`)
  } else {
    window.showToast('Нечего отменять')
  }
}

onMounted(async () => {
  initSounds()
  const savedMode = localStorage.getItem('separateScanMode')
  if (savedMode === 'tsd' || savedMode === 'camera') scanMode.value = savedMode

  // Загрузка всех separate items при входе
  await separateStore.loadSeparateItems()

  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  if (scanner) {
    scanner.cleanup()
    scanner = null
  }
  isScanning.value = false
  showScanner.value = false
  window.removeEventListener('keydown', handleKeyDown)
})

watch(scanMode, (newMode, oldMode) => {
  if (newMode === oldMode) return
  localStorage.setItem('separateScanMode', newMode)
  if (newMode === 'camera') {
    nextTick(() => startScanner())
  } else {
    stopScanner()
  }
  window.showToast(`Режим: ${newMode === 'tsd' ? 'ТСД' : 'Камера'}`)
})

async function startScanner() {
  if (isScanning.value) return
  const hasCameraSupport = await checkCameraSupport()
  if (!hasCameraSupport) {
    window.showToast('Камера недоступна. Требуется HTTPS и разрешение браузера.')
    return
  }
  try {
    showScanner.value = true
    await nextTick()
    if (!scanner) scanner = createScanner(scannerElementId)
    isScanning.value = true
    await scanner.start(
      (decodedText) => {
        const scannedCode = decodedText?.trim()
        if (navigator.vibrate) navigator.vibrate(50)
        handleScanResult(scannedCode)
      },
      () => {}
    )
  } catch (error) {
    window.showToast('Ошибка доступа к камере')
    stopScanner()
  }
}

function stopScanner() {
  if (scanner) {
    scanner.cleanup()
    scanner = null
  }
  isScanning.value = false
  showScanner.value = false
}

function handleStopScanner() {
  stopScanner()
}

async function handleScanResult(result) {
  if (window.isProcessingStopItem) return { success: false, error: 'processing' }
  const barcode = result.barcode || result
  if (!barcode) return { success: false, error: 'no_barcode' }

  const parsedBarcode = parseBarcodeToBrainNumber(barcode)
  const finalBarcode = parsedBarcode || barcode
  const item = brainStore.findByBarcode(finalBarcode)

  if (!item) {
    playSound('error')
    if (navigator.vibrate) navigator.vibrate([50, 50, 50])
    window.showToast(`Товар отсутствует в БД: ${finalBarcode}`)
    return { success: false, error: 'not_found' }
  }

  if (brainStore.isStopItem(item)) {
    playSound('error')
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100])
    currentStopItem.value = item
    showStopItemModal.value = true
    stopScanner()
    return { success: false, error: 'stop_item' }
  }

  if (separateStore.isDuplicate(finalBarcode)) {
    playSound('error')
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    currentDuplicateItem.value = item
    showDuplicateModal.value = true
    stopScanner()
    return { success: false, error: 'duplicate' }
  }

  const result_add = await separateStore.addItem(item)
  if (result_add?.success) {
    playSound('success')
    if (navigator.vibrate) navigator.vibrate([50, 30, 50])
    window.showToast(`✓ Добавлено: ${item.name}`)
    stopScanner()
    return { success: true }
  } else if (result_add?.error === 'duplicate') {
    playSound('error')
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    currentDuplicateItem.value = item
    showDuplicateModal.value = true
    stopScanner()
    return { success: false, error: 'duplicate' }
  } else {
    playSound('error')
    window.showToast('Ошибка добавления')
    return { success: false, error: 'add_failed' }
  }
}

async function handleTsdInput() {
  if (isProcessingTsd.value) return
  let input = tsdInput.value?.trim()
  if (!input) return
  isProcessingTsd.value = true
  let barcode = ensurePrefix(parseBarcodeToBrainNumber(input))
  if (!barcode) {
    window.showToast(`Неверный формат: ${input}`)
    isProcessingTsd.value = false
    tsdInput.value = ''
    return
  }
  const result = await handleScanResult(barcode)
  // FIX: теперь handleScanResult возвращает { success, error } — корректная обработка
  if (result?.error === 'duplicate') {
    window.showToast('Дубликат товара', 3000, 'warning')
  } else if (!result?.success && result?.error) {
    // Показываем конкретные сообщения из handleScanResult — не дублируем toast
    const errorMessages = {
      not_found: `Товар отсутствует в БД: ${barcode}`,
      stop_item: 'Остановочный товар — проверьте вручную',
      processing: 'Подождите завершения обработки'
    }
    if (errorMessages[result.error]) {
      window.showToast(errorMessages[result.error], 3000, 'warning')
    } else {
      window.showToast('Ошибка добавления товара', 3000, 'error')
    }
  }
  tsdInput.value = ''
  nextTick(() => {
    isProcessingTsd.value = false
  })
}

const showRemoveModal = ref(false)
const removeIndex = ref(null)

function requestRemoveItem(index) {
  removeIndex.value = index
  showRemoveModal.value = true
}

async function confirmRemove() {
  if (removeIndex.value !== null) {
    await separateStore.removeItem(removeIndex.value)
    window.showToast('Товар удалён')
  }
  showRemoveModal.value = false
  removeIndex.value = null
}

const showFinishModal = ref(false)

function finishSeparate() {
  if (separateStore.totalItems === 0) {
    window.showToast('Список пуст')
    return
  }
  showFinishModal.value = true
}

async function confirmFinish() {
  showFinishModal.value = false
  const exportResult = await exportSeparateToExcel(separateStore.items, {
    position: collectorStore.position,
    fullName: collectorStore.fullName
  })
  if (exportResult.success) {
    window.showToast(`Файл скачан: ${exportResult.filename}`)
    separateStore.clearAll()
  } else {
    window.showToast('Ошибка экспорта: ' + exportResult.error)
  }
}

const showClearModal = ref(false)

function clearList() {
  if (separateStore.totalItems === 0) {
    window.showToast('Список и так пуст')
    return
  }
  showClearModal.value = true
}

async function confirmClear() {
  await separateStore.clearAll()
  window.showToast('Список очищен')
  showClearModal.value = false
}
</script>

<template>
  <div
    class="separate-view min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pb-20"
  >
    <!-- Nav Bar -->
    <NavBar
      title="Отдельные товары"
      left-text="Назад"
      left-arrow
      right-text="Очистить"
      :right-disabled="separateStore.totalItems === 0"
      @click-left="$router.back()"
      @click-right="showClearModal = true"
    />

    <main class="content px-4 py-4">
      <!-- Переключатель режимов -->
      <div class="mode-switcher mb-4">
        <div class="grid grid-cols-2 gap-3">
          <button
            :class="[
              'py-3.5 rounded-xl text-base font-semibold transition-all duration-200 border-none cursor-pointer flex items-center justify-center gap-2',
              scanMode === 'tsd'
                ? 'bg-gradient-to-r from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-500/30'
                : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700'
            ]"
            @click="scanMode = 'tsd'"
          >
            <img src="/img/bank-terminal.svg" alt="ТСД" class="w-5 h-5" />
            ТСД
          </button>
          <button
            :class="[
              'py-3.5 rounded-xl text-base font-semibold transition-all duration-200 border-none cursor-pointer flex items-center justify-center gap-2',
              scanMode === 'camera'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30'
                : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700'
            ]"
            @click="scanMode = 'camera'"
          >
            <img src="/img/camera-svg.svg" alt="Камера" class="w-5 h-5" />
            Камера
          </button>
        </div>
      </div>

      <!-- Поле ввода для ТСД -->
      <div v-if="scanMode === 'tsd'" class="tsd-input-wrapper mb-4">
        <div class="flex items-center gap-2">
          <Input
            v-model="tsdInput"
            placeholder="Сканируйте или введите номер"
            icon="scan"
            clearable
            class="flex-1"
            @keyup.enter="handleTsdInput"
            @change="handleTsdInput"
            @blur="handleTsdInput"
          />
          <Button size="md" @click="handleTsdInput">Добавить</Button>
        </div>
        <p class="text-xs text-slate-500 mt-2 ml-2">
          💡 Введите номер товара (например 45328) — префикс добавится автоматически
        </p>
      </div>

      <!-- Карточка информации -->
      <div class="info-card mb-4">
        <div
          class="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-3xl p-3 text-white shadow-lg shadow-emerald-500/20 border border-emerald-500/30"
        >
          <div class="flex items-center gap-4">
            <div
              class="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center text-2xl flex-shrink-0"
            >
              🚚
            </div>
            <div class="flex-1">
              <h3 class="font-semibold text-lg mb-1">Отдельные товары</h3>
              <p class="text-sm text-white/80">
                Товаров: <span class="font-bold text-white">{{ separateStore.totalItems }}</span>
              </p>
            </div>
            <Badge variant="success" class="px-2 py-2 text-center text-xs">1 товар = 1 место</Badge>
          </div>
        </div>
      </div>

      <!-- Кнопка сканирования -->
      <div v-if="scanMode === 'camera'" class="scan-section mb-4">
        <Button
          :loading="isScanning"
          :class="[
            'w-full py-4 rounded-2xl text-base font-semibold shadow-lg',
            isScanning
              ? 'bg-gradient-to-r from-rose-500 to-rose-700 shadow-rose-500/30'
              : 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-500/30'
          ]"
          @click="startScanner"
        >
          <van-icon :name="isScanning ? 'play-circle-o' : 'scan'" size="20" />
          {{ isScanning ? 'Сканирование...' : 'Старт' }}
        </Button>
        <p class="text-sm text-slate-500 mt-3 text-center">📷 Нажмите «Старт» для сканирования</p>
      </div>

      <!-- Список товаров -->
      <div class="items-list-section mb-4">
        <div
          class="bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-2xl overflow-hidden"
        >
          <div class="p-4 border-b border-slate-700">
            <h3 class="font-semibold text-slate-100 flex items-center gap-2">
              <van-icon name="bag-o" class="text-primary-400" />
              Товары в списке
            </h3>
          </div>
          <div class="p-4">
            <!-- Loader при загрузке -->
            <Loader v-if="separateStore.isSyncing" text="Загрузка товаров..." />

            <div v-else-if="separateStore.totalItems === 0" class="text-center py-8">
              <div
                class="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-3"
              >
                <van-icon name="bag-o" size="32" color="#64748b" />
              </div>
              <p class="text-slate-400 text-sm">Пока нет товаров. Отсканируйте штрихкод.</p>
            </div>
            <div v-else class="items-list-detail space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
              <div
                v-for="(item, index) in separateStore.items"
                :key="index"
                class="item-row p-3 rounded-xl transition-all duration-200"
                :class="
                  separateStore.lastScannedItem?.number === item.number
                    ? 'bg-amber-500/20 border-2 border-amber-500'
                    : 'bg-slate-700/50 hover:bg-slate-700'
                "
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow-md"
                  >
                    <span class="text-xs font-bold text-white">{{
                      String(index + 1).padStart(3, '0')
                    }}</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5">
                      <span
                        class="text-xs font-semibold text-primary-400 bg-primary-500/20 px-2 py-0.5 rounded-md border border-primary-500/30"
                      >
                        {{ item.article }}
                      </span>
                      <van-icon
                        v-if="separateStore.lastScannedItem?.number === item.number"
                        name="star"
                        size="14"
                        color="#fbbf24"
                        class="mr-1"
                      />
                    </div>
                    <p class="text-sm font-medium text-slate-100 truncate">{{ item.name }}</p>
                  </div>
                  <div class="flex items-center gap-3 flex-shrink-0">
                    <span class="text-xs font-mono text-slate-500">{{ item.number }}</span>
                    <van-icon
                      name="delete-o"
                      size="20"
                      color="#f87171"
                      class="cursor-pointer hover:scale-110 transition-transform"
                      @click="requestRemoveItem(index)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Кнопки действий -->
      <div class="bottom-actions flex gap-2">
        <Button
          class="basis-full"
          variant="warning"
          :disabled="!separateStore.canUndo"
          :class="!separateStore.canUndo ? 'opacity-50' : ''"
          @click="performUndo"
        >
          <van-icon name="replay" />
          Отмена
        </Button>
        <Button
          class="basis-full"
          variant="success"
          :disabled="separateStore.totalItems === 0"
          :class="separateStore.totalItems === 0 ? 'opacity-50' : ''"
          @click="finishSeparate"
        >
          <van-icon name="down" />
          Завершить
        </Button>
      </div>
    </main>

    <!-- Модальное окно сканера -->
    <Modal
      :model-value="showScanner"
      confirm-text="Стоп"
      confirm-color="danger"
      @update:model-value="
        (val) => {
          showScanner = val
          if (!val) stopScanner()
        }
      "
      @confirm="handleStopScanner"
    >
      <div class="text-center mb-4">
        <h3 class="font-semibold text-slate-100 mb-1">📷 Сканирование штрихкода</h3>
        <p class="text-sm text-slate-400">Наведите камеру на штрихкод</p>
      </div>
      <div class="scanner-element rounded-2xl overflow-hidden mb-4 relative">
        <div :id="scannerElementId" class="w-full"></div>
        <!-- Сканирующая линия -->
        <div class="scan-line"></div>
        <!-- Рамка сканера -->
        <div class="scan-frame"></div>
      </div>
    </Modal>

    <!-- Модальное окно стоп-товара -->
    <Modal
      v-model="showStopItemModal"
      title="⛔ Стоп-товар!"
      :show-cancel="false"
      confirm-text="OK"
      @confirm="showStopItemModal = false"
    >
      <div v-if="currentStopItem" class="text-left space-y-3">
        <div>
          <p class="text-xs text-slate-400 mb-1">Наименование</p>
          <p class="text-slate-100 font-medium">{{ currentStopItem.name }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-400 mb-1">Номер</p>
          <p class="text-slate-100 font-mono">{{ currentStopItem.number }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-400 mb-1">Комментарий</p>
          <p class="text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            {{ currentStopItem.comment || 'Нет комментария' }}
          </p>
        </div>
        <p class="text-xs text-slate-500 mt-2">
          Этот товар нельзя отгружать в брак. Обратитесь к руководству для уточнения.
        </p>
      </div>
    </Modal>

    <!-- Модальное окно дубликата -->
    <Modal
      v-model="showDuplicateModal"
      title="⚠️ Дубликат!"
      :show-cancel="false"
      confirm-text="OK"
      @confirm="showDuplicateModal = false"
    >
      <div v-if="currentDuplicateItem" class="text-left space-y-3">
        <div>
          <p class="text-xs text-slate-400 mb-1">Наименование</p>
          <p class="text-slate-100 font-medium">{{ currentDuplicateItem.name }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-400 mb-1">Номер</p>
          <p class="text-slate-100 font-mono">{{ currentDuplicateItem.number }}</p>
        </div>
        <p class="text-xs text-slate-500 mt-2">
          Этот товар уже был добавлен в список. Повторное добавление невозможно.
        </p>
      </div>
    </Modal>

    <!-- Модальное окно удаления -->
    <Modal
      v-model="showRemoveModal"
      title="Удалить товар?"
      show-cancel
      confirm-text="Удалить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmRemove"
    >
      <p v-if="removeIndex !== null" class="text-slate-400 text-center">
        {{ separateStore.items[removeIndex]?.name }} ({{
          separateStore.items[removeIndex]?.number
        }})
      </p>
    </Modal>

    <!-- Модальное окно завершения -->
    <Modal
      v-model="showFinishModal"
      title="Завершить список?"
      show-cancel
      confirm-text="Завершить"
      cancel-text="Отмена"
      @confirm="confirmFinish"
    >
      <p class="text-slate-400 text-center">
        В списке {{ separateStore.totalItems }} товаров. Будет скачан Excel файл.
      </p>
    </Modal>

    <!-- Модальное окно очистки -->
    <Modal
      v-model="showClearModal"
      title="Очистить список?"
      show-cancel
      confirm-text="Очистить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmClear"
    >
      <p class="text-slate-400 text-center">Все товары будут удалены</p>
    </Modal>
  </div>
</template>

<style scoped>
.separate-view {
  padding-bottom: 140px;
}

/* Scanner element */
.scanner-element {
  position: relative;
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  min-height: 250px;
  background: #0f172a;
}

.scan-frame {
  position: absolute;
  inset: 10%;
  border: 3px solid rgba(236, 72, 153, 0.8);
  border-radius: 16px;
  pointer-events: none;
  z-index: 10;
  box-shadow: 0 0 15px rgba(236, 72, 153, 0.3);
}

.scan-line {
  position: absolute;
  left: 10%;
  right: 10%;
  height: 3px;
  background: linear-gradient(90deg, transparent, #ec4899, transparent);
  z-index: 11;
  animation: scan 2s ease-in-out infinite;
  box-shadow: 0 0 15px rgba(236, 72, 153, 0.6);
}

@keyframes scan {
  0%,
  100% {
    top: 20%;
  }
  50% {
    top: 78%;
  }
}

/* Items list scrollbar */
.items-list-detail::-webkit-scrollbar {
  width: 6px;
}

.items-list-detail::-webkit-scrollbar-track {
  background: #1e293b;
  border-radius: 3px;
}

.items-list-detail::-webkit-scrollbar-thumb {
  background: #475569;
  border-radius: 3px;
}
</style>
<!-- SeparateView — отдельный сбор товаров (overflow контейнеров) -->
