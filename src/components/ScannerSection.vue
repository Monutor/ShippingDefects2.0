<!-- eslint-disable vue/no-mutating-props -->
<script setup>
import { watch, nextTick, computed, ref } from 'vue'
import { Button, Input } from '@/components/ui'
import { useBrainStore } from '@/stores/brain'

const props = defineProps({
  scanner: { type: Object, required: true },
  onTsdSubmit: { type: Function, default: null }
})

const brainStore = useBrainStore()
const showSuggestions = ref(false)

const tsdInputProxy = computed({
  get: () => props.scanner?.tsdInput?.value ?? '',
  set: (val) => {
    if (props.scanner?.tsdInput) props.scanner.tsdInput.value = val
  }
})

const query = computed(() => (tsdInputProxy.value || '').trim().toLowerCase())

const suggestions = computed(() => {
  if (!query.value) return []
  const q = query.value
  return brainStore.items
    .filter((item) => {
      const num = (item.number || '').toLowerCase()
      const name = (item.name || '').toLowerCase()
      const art = (item.article || '').toLowerCase()
      return num.includes(q) || name.includes(q) || art.includes(q)
    })
    .slice(0, 20)
})

watch(query, (q) => {
  if (q && props.scanner.scanMode.value === 'tsd') {
    showSuggestions.value = true
  }
})

const emit = defineEmits(['mode-change', 'select-camera', 'tsd-submit', 'tsd-change'])

// Автофокус на скрытое readonly-поле в ТД-режиме: DataWedge HID доставляет
// штрихкод только в сфокусированное поле. Переключение на «Камера» снимает
// фокус, чтобы пиканье не уходило в фон.
watch(
  () => props.scanner.scanMode.value,
  (mode) => {
    if (mode === 'tsd') nextTick(() => props.scanner.focusTsdCapture())
    else props.scanner.blurTsdCapture()
  },
  { immediate: true }
)

function handleModeChange(mode) {
  emit('mode-change', mode)
}

function handleSelectCamera(deviceId) {
  emit('select-camera', deviceId)
}

async function submitTsd() {
  const input = props.scanner.tsdInput.value?.trim()
  if (!input) return
  try {
    if (props.onTsdSubmit) await props.onTsdSubmit(input)
    else emit('tsd-submit', input)
  } catch (err) {
    // Магазин не настроен или код чужого магазина — парсер бросает Error
    if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    window.showToast(err.message || 'Ошибка обработки кода')
  }
  showSuggestions.value = false
}

function selectSuggestion(item) {
  tsdInputProxy.value = item.number
  showSuggestions.value = false
  // небольшая задержка чтобы значение применилось
  window.setTimeout(() => submitTsd(), 0)
}

function hideSuggestions() {
  window.setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}
</script>

<template>
  <div class="space-y-3">
    <!-- Mode switcher -->
    <div class="mode-switcher mb-4">
      <div class="grid grid-cols-2 gap-3">
        <button
          :class="[
            'py-3.5 rounded-xl text-base font-semibold transition-all duration-200 border-none cursor-pointer flex items-center justify-center gap-2',
            scanner.scanMode.value === 'tsd'
              ? 'bg-gradient-to-r from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-500/30'
              : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700'
          ]"
          @click="handleModeChange('tsd')"
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
          @click="handleModeChange('camera')"
        >
          <img src="/img/camera-svg.svg" alt="Камера" class="w-5 h-5" /> Камера
        </button>
      </div>
    </div>

    <!-- TSD input -->
    <div v-if="scanner.scanMode.value === 'tsd'" class="space-y-3 mt-4">
      <!-- Скрытое readonly-поле для HID-пикания ТСД (DataWedge). Не занимает
           место и не ловит тапы, но принимает штрихкод в сфокусированном виде. -->
      <input
        id="tsd-capture-input"
        :value="scanner.tsdCapture.value"
        type="text"
        readonly
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        class="tsd-capture-input"
        @input="(e) => scanner.onTsdCaptureInput(e)"
        @keyup.enter="scanner.finishTsdCapture()"
      />
      <div class="flex gap-2">
        <div class="relative flex-1">
          <Input
            v-model="tsdInputProxy"
            placeholder="📱 Штрихкод или номер товара"
            :disabled="scanner.isProcessingTsd.value"
            variant="primary"
            size="large"
            clearable
            @keyup.enter="submitTsd"
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
        <Button
          size="md"
          :loading="scanner.isProcessingTsd.value"
          :disabled="!tsdInputProxy"
          @click="submitTsd"
        >
          Добавить
        </Button>
      </div>
      <p class="text-xs text-slate-400 mt-1 ml-2">
        💡 Введите номер товара (например 45328) — префикс добавится автоматически
      </p>
    </div>

    <!-- Camera controls -->
    <div v-if="scanner.scanMode.value === 'camera'" class="space-y-3">
      <div v-if="scanner.cameras.value.length > 1 && !scanner.isScanning.value" class="space-y-2">
        <p class="text-xs text-slate-400">📷 Камера:</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="(cam, idx) in scanner.cameras.value"
            :key="cam.deviceId"
            type="button"
            :class="[
              'px-3 py-2 rounded-lg text-sm border transition-colors cursor-pointer',
              cam.deviceId === scanner.selectedCameraId.value
                ? 'bg-primary-500/20 border-primary-500/30 text-primary-400'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
            ]"
            @click="handleSelectCamera(cam.deviceId)"
          >
            {{ cam.label || `Камера ${idx + 1}` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tsd-capture-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  background: transparent;
  color: transparent;
  outline: none;
  opacity: 0;
  pointer-events: none;
  user-select: none;
}
</style>
