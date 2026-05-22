<script setup>
import { computed } from 'vue'
import { Button, Input, Badge, NavBar, Modal, Loader } from '@/components/ui'

const props = defineProps({
  store: { type: Object, required: true },
  containerType: { type: String, required: true },
  containerLabel: { type: String, required: true },
  containerLabelPlural: { type: String, required: true },
  navTitle: { type: String, required: true },
  rightText: { type: String, default: 'Результаты' },
  rightRoute: { type: [String, Object], default: '/boxes' },
  activeContainers: { type: Array, required: true },
  items: { type: Array, required: true },
  showScanner: { type: Boolean, required: true },
  showStopItemModal: { type: Boolean, required: true },
  currentStopItem: { type: Object, default: null },
  showRemoveModal: { type: Boolean, required: true },
  removeItemRef: { type: Object, default: null },
  showFinishModal: { type: Boolean, required: true },
  scanner: { type: Object, required: true },
  isOwner: { type: Boolean, required: true },
  isLoading: { type: Boolean, default: false },
  showMixesSection: { type: Boolean, default: false },
  availableMixes: { type: Array, default: () => [] },
  isLoadingMixes: { type: Boolean, default: false },
  finishModalTitle: { type: String, default: '' },
  finishModalDescription: { type: String, default: '' },
  finishModalConfirmText: { type: String, default: 'Да, завершить' },
  getItemHighlight: { type: Function, default: () => '' }
})

const emit = defineEmits([
  'click-left',
  'click-right',
  'create-container',
  'select-container',
  'start-scanner',
  'stop-scanner',
  'finish',
  'confirm-finish',
  'cancel-container',
  'undo',
  'remove-item',
  'confirm-remove',
  'load-mixes',
  'add-mix',
  'refresh-items',
  'update:showRemoveModal',
  'update:showStopItemModal',
  'update:showFinishModal'
])

const currentContainer = computed(() => props.store.currentPallet || props.store.currentBox || null)
const containerItemCount = computed(() => {
  if (props.containerType === 'pallet') {
    return props.store.currentPallet?.items?.length || 0
  }
  return props.store.currentBoxItemsCount || 0
})
const canUndo = computed(() => {
  if (props.containerType === 'pallet') return props.store.canUndo
  return props.store.canUndo
})
const finishButtonText = computed(() => {
  return props.containerType === 'pallet' ? 'Завершить паллет' : 'Готово'
})
const modalTitle = computed(() => {
  return props.finishModalTitle || `Завершить ${props.containerLabel}?`
})
const modalDescription = computed(() => {
  return props.finishModalDescription || `Вы уверены что хотите завершить ${props.containerLabel}?`
})

function handleScanModeChange(mode) {
  props.scanner.scanMode.value = mode
}

function handleScannerToggle() {
  if (props.scanner.isScanning.value) {
    props.scanner.stopScanner()
  } else {
    emit('start-scanner')
  }
}

function handleScannerModalUpdate(val) {
  emit('update:showScanner', val)
  if (!val) {
    emit('stop-scanner')
  }
}
</script>

<template>
  <div class="container-view bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pb-20">
    <NavBar
      :title="navTitle"
      left-text="Назад"
      left-arrow
      :right-text="activeContainers.length > 0 ? 'Смотреть' : rightText"
      @click-left="$emit('click-left')"
      @click-right="$emit('click-right')"
    />

    <!-- Loading Overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <Loader text="Загрузка контейнеров..." />
    </div>

    <main v-show="!isLoading" class="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
      <!-- Status Bar -->
      <div
        v-if="currentContainer"
        class="status-bar bg-slate-800/80 border border-slate-700 rounded-2xl p-4 text-center"
      >
        <div class="flex items-center justify-center gap-3 mb-2">
          <Badge :count="containerItemCount" variant="info" />
          <span class="text-slate-100 font-medium">{{
            currentContainer?.name || `${containerLabel} не выбран`
          }}</span>
        </div>
      </div>

      <!-- Empty state: no containers at all -->
      <div
        v-if="!currentContainer && activeContainers.length === 0"
        class="absolute inset-0 flex flex-col items-center justify-center"
      >
        <button
          class="w-20 h-20 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 flex items-center justify-center transition-colors shadow-lg shadow-blue-600/30"
          @click="$emit('create-container')"
        >
          <svg
            class="w-10 h-10 text-white"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
        <p class="mt-4 text-slate-400 text-sm">Создайте {{ containerLabel }} для начала работы</p>
      </div>

      <!-- Empty state: has containers but none selected -->
      <div
        v-if="!currentContainer && activeContainers.length > 0"
        class="flex flex-col items-center justify-center py-8"
      >
        <button
          class="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 flex items-center justify-center transition-colors shadow-lg shadow-blue-600/30"
          @click="$emit('create-container')"
        >
          <svg
            class="w-8 h-8 text-white"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
        <p class="mt-3 text-slate-400 text-sm">Создайте {{ containerLabel }} для начала работы</p>
      </div>

      <!-- Existing containers list -->
      <div
        v-if="!currentContainer && activeContainers.length > 0"
        class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4"
      >
        <h3 class="font-semibold text-slate-100 mb-3">Или выберите существующий</h3>
        <div class="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
          <div
            v-for="container in activeContainers"
            :key="'c' + container.id"
            class="item-row p-3 rounded-xl bg-slate-700/80 hover:bg-slate-600 cursor-pointer transition-colors"
            @click="$emit('select-container', container)"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-slate-100">{{
                container.name || containerLabel
              }}</span>
              <span class="text-xs text-slate-400">Собиратель: {{ container.collector_id }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Scanning Section -->
      <div v-if="currentContainer" class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
        <h3 class="font-semibold text-slate-100 mb-3 flex items-center gap-2">
          <van-icon name="scan" class="text-primary-400" aria-hidden="true" /> Сканирование
        </h3>

        <div class="mode-switcher mb-4">
          <div class="grid grid-cols-2 gap-3">
            <button
              :class="[
                'py-3.5 rounded-xl text-base font-semibold transition-all duration-200 border-none cursor-pointer flex items-center justify-center gap-2',
                scanner.scanMode.value === 'tsd'
                  ? 'bg-gradient-to-r from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-500/30'
                  : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700'
              ]"
              @click="handleScanModeChange('tsd')"
            >
              <img src="/img/bank-terminal.svg" alt="ТСД" class="w-5 h-5" /> ТСД
            </button>
            <button
              :class="[
                'py-3.5 rounded-xl text-base font-semibold transition-all duration-200 border-none cursor-pointer flex items-center justify-center gap-2',
                scanner.scanMode.value === 'camera'
                  ? 'bg-gradient-to-r from-purple-500 to-purple-700 text-white shadow-lg shadow-purple-500/30'
                  : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700'
              ]"
              @click="handleScanModeChange('camera')"
            >
              <img src="/img/camera-svg.svg" alt="Камера" class="w-5 h-5" /> Камера
            </button>
          </div>
        </div>

        <div v-if="scanner.scanMode.value === 'tsd'" class="space-y-3 mt-4">
          <Input
            v-model="scanner.tsdInput.value"
            placeholder="📱 Введите штрихкод и нажмите Enter"
            :disabled="scanner.isProcessingTsd.value"
            variant="primary"
            size="large"
            @keyup.enter="scanner.handleTsdInput()"
          />
          <p class="text-xs text-slate-400 mt-1 ml-2">
            💡 Введите номер товара (например 45328) — префикс добавится автоматически
          </p>
        </div>

        <div v-if="scanner.scanMode.value === 'camera'" class="space-y-3">
          <Button variant="primary" block @click="handleScannerToggle">
            <van-icon
              :name="scanner.isScanning.value ? 'stop-circle-o' : 'scan'"
              size="20"
              aria-hidden="true"
            />
            {{ scanner.isScanning.value ? 'Сканирование...' : 'Старт' }}
          </Button>
          <p class="text-sm text-slate-500 mt-3 text-center">
            📷 Нажмите «Старт» для сканирования одного кода
          </p>
        </div>
      </div>

      <!-- Mixes Section (Pallet only) -->
      <div v-if="currentContainer && isOwner && showMixesSection" class="mt-4">
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden">
          <div class="p-4 border-b border-slate-700 flex items-center justify-between">
            <h3 class="font-semibold text-slate-100 flex items-center gap-2">
              <van-icon name="bag" class="text-primary-400" aria-hidden="true" /> Готовые миксы
            </h3>
            <button
              class="text-primary-400 text-sm flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors"
              aria-label="Обновить список миксов"
              @click="$emit('load-mixes')"
            >
              <van-icon name="replay" size="14" aria-hidden="true" /> Обновить
            </button>
          </div>
          <div class="p-4">
            <div v-if="isLoadingMixes" class="text-center py-6">
              <p class="text-slate-400 text-sm">Загрузка...</p>
            </div>
            <div v-else-if="availableMixes.length === 0" class="text-center py-6">
              <p class="text-slate-500 text-sm">Нет завершённых миксов</p>
            </div>
            <div v-else class="space-y-2 max-h-64 overflow-y-auto">
              <div
                v-for="mix in availableMixes"
                :key="mix.id"
                class="flex items-center justify-between p-3 bg-slate-700/80 rounded-xl"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-100 truncate">
                    Микс #{{ mix.number }}
                  </p>
                  <p class="text-xs text-slate-400">{{ mix.name }}</p>
                </div>
                <button
                  class="ml-3 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0"
                  @click="$emit('add-mix', mix)"
                >
                  + Добавить
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Items List -->
      <div
        v-if="currentContainer"
        class="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden"
      >
        <div class="p-4 border-b border-slate-700 flex items-center justify-between">
          <h3 class="font-semibold text-slate-100 flex items-center gap-2">
            <van-icon name="bag-o" class="text-primary-400" aria-hidden="true" /> Товары в
            {{ containerLabel }}е ({{ containerItemCount }})
          </h3>
          <button
            v-if="showMixesSection"
            class="text-primary-400 text-sm flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors"
            aria-label="Обновить список товаров"
            @click="$emit('refresh-items')"
          >
            <van-icon name="replay" size="14" aria-hidden="true" /> Обновить
          </button>
        </div>
        <div class="p-4">
          <div v-if="items.length === 0" class="text-center py-8">
            <div
              class="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-3"
            >
              <van-icon name="bag-o" size="32" color="#64748b" aria-hidden="true" />
            </div>
            <p class="text-slate-500 text-sm">Пока нет товаров. Отсканируйте штрихкод.</p>
          </div>
          <div v-else class="items-list-detail space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
            <div
              v-for="(item, index) in items"
              :key="index"
              class="item-row p-3 rounded-xl transition-all duration-200 relative"
              :class="getItemHighlight(item, index)"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  :class="
                    getItemHighlight(item, index).includes('emerald')
                      ? 'bg-emerald-500/20 border border-emerald-500/30'
                      : 'bg-primary-500/20 border border-primary-500/30'
                  "
                >
                  <span
                    class="text-xs font-bold"
                    :class="
                      getItemHighlight(item, index).includes('emerald')
                        ? 'text-emerald-400'
                        : 'text-primary-400'
                    "
                    >{{ index + 1 }}</span
                  >
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-100 truncate mb-1">{{ item.name }}</p>
                  <p class="text-xs text-slate-400 font-mono">{{ item.number || '—' }}</p>
                  <p v-if="item.article" class="text-xs text-slate-500 mt-1">{{ item.article }}</p>
                </div>
                <button
                  v-if="isOwner"
                  class="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center flex-shrink-0 hover:bg-red-500/40 transition-colors"
                  aria-label="Удалить товар"
                  @click="$emit('remove-item', item)"
                >
                  <van-icon name="delete-o" size="16" color="#ef4444" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div v-if="currentContainer && isOwner" class="box-actions space-y-2">
        <div class="grid grid-cols-3 gap-2">
          <Button
            variant="secondary"
            :disabled="!canUndo"
            class="custom-btn-secondary"
            @click="$emit('undo')"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
            Отмена
          </Button>
          <Button variant="danger" class="custom-btn-danger" @click="$emit('cancel-container')">
            <svg
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Сброс
          </Button>
          <Button
            variant="success"
            :disabled="containerItemCount === 0"
            :class="containerItemCount === 0 ? 'opacity-50' : ''"
            class="custom-btn-success"
            @click="$emit('finish')"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {{ finishButtonText }}
          </Button>
        </div>
      </div>
    </main>

    <!-- Scanner Modal -->
    <Modal
      :model-value="showScanner"
      confirm-text="Стоп"
      confirm-color="danger"
      @update:model-value="handleScannerModalUpdate"
      @confirm="$emit('stop-scanner')"
    >
      <div class="text-center mb-4">
        <h3 class="font-semibold text-slate-100 mb-1">📷 Сканирование штрихкода</h3>
        <p class="text-sm text-slate-400">Наведите камеру на штрихкод</p>
      </div>
      <div class="scanner-element rounded-2xl overflow-hidden mb-4 relative">
        <div :id="scanner.scannerElementId" class="w-full"></div>
        <div class="scan-line"></div>
        <div class="scan-frame"></div>
      </div>
    </Modal>

    <!-- Stop Item Modal -->
    <Modal
      :model-value="showStopItemModal"
      title="⛔ Стоп-товар!"
      :show-cancel="false"
      confirm-text="OK"
      @update:model-value="$emit('update:showStopItemModal', $event)"
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

    <!-- Remove Item Modal -->
    <Modal
      :model-value="showRemoveModal"
      title="Удалить товар?"
      show-cancel
      confirm-text="Удалить"
      cancel-text="Отмена"
      confirm-color="danger"
      @update:model-value="$emit('update:showRemoveModal', $event)"
      @confirm="$emit('confirm-remove')"
    >
      <p class="text-slate-400 text-center">
        {{ removeItemRef?.name }} ({{ removeItemRef?.number }})
      </p>
    </Modal>

    <!-- Finish Modal -->
    <Modal
      :model-value="showFinishModal"
      :title="modalTitle"
      show-cancel
      :confirm-text="finishModalConfirmText"
      cancel-text="Отмена"
      @update:model-value="$emit('update:showFinishModal', $event)"
      @confirm="$emit('confirm-finish')"
    >
      <div class="text-left space-y-3 text-white">
        <p>{{ modalDescription }}</p>
        <div class="bg-slate-800/50 rounded-lg p-4">
          <p>
            <strong>{{ containerType === 'pallet' ? 'Паллет' : 'Микс' }}:</strong>
            {{ currentContainer?.name }}
          </p>
          <p><strong>Товаров:</strong> {{ containerItemCount }}</p>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.custom-btn-secondary {
  background: rgba(107, 114, 128, 0.2);
  border-color: rgba(107, 114, 128, 0.3);
}
.custom-btn-danger {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border-color: #dc2626;
}
.custom-btn-success {
  background: linear-gradient(135deg, #10b981 0%, #059652 100%);
  border-color: #059652;
}
.item-row:hover {
  transform: translateX(4px);
}
.new-badge {
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
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
}
.container-view {
  min-height: 100vh;
}
main {
  flex: 1;
}
.scanner-element {
  position: relative;
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
.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(4px);
}
</style>
