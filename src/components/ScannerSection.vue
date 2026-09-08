<!-- eslint-disable vue/no-mutating-props -->
<script setup>
import { Button, Input } from '@/components/ui'

const props = defineProps({
  scanner: { type: Object, required: true },
  onTsdSubmit: { type: Function, default: null }
})

const emit = defineEmits(['mode-change', 'select-camera', 'tsd-submit', 'tsd-change'])

function handleModeChange(mode) {
  emit('mode-change', mode)
}

function handleSelectCamera(deviceId) {
  emit('select-camera', deviceId)
}

async function submitTsd() {
  const input = props.scanner.tsdInput.value?.trim()
  if (props.onTsdSubmit) await props.onTsdSubmit(input)
  else emit('tsd-submit', input)
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
      <div class="flex gap-2">
        <Input
          :model-value="scanner.tsdInput.value"
          placeholder="📱 Штрихкод или номер товара"
          :disabled="scanner.isProcessingTsd.value"
          variant="primary"
          size="large"
          @update:model-value="(val) => emit('tsd-change', val)"
          @keyup.enter="submitTsd"
        />
        <Button size="md" :loading="scanner.isProcessingTsd.value" @click="submitTsd">
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
