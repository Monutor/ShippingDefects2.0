import { ref, nextTick } from 'vue'
import { createScanner, checkCameraSupport } from '@/utils/scanner'

/**
 * Композабл для управления сканером штрихкодов.
 *
 * Предоставляет:
 *  - Управление состоянием сканера (isScanning)
 *  - Запуск/остановку камеры с проверкой поддержки
 *  - Обработку ТСД-ввода (парсинг, нормализация, debounce)
 *  - Очистку ресурсов при unmount
 *
 * View самостоятельно управляет:
 *  - Показом модалки сканера (showScanner)
 *  - Звуками и вибрацией
 *  - Бизнес-логикой обработки штрихкода
 */
export function useScanner(options = {}) {
  const { elementId = 'barcode-scanner', onScanSuccess, onScanComplete } = options

  const isScanning = ref(false)
  let scanner = null

  const scanMode = ref('tsd')
  const tsdInput = ref('')
  const isProcessingTsd = ref(false)

  async function startScanner() {
    if (isScanning.value) return

    const hasCamera = await checkCameraSupport()
    if (!hasCamera) {
      window.showToast('Камера не найдена')
      return
    }

    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 300))

    if (!document.getElementById(elementId)) return

    await new Promise((resolve) => setTimeout(resolve, 500))

    isScanning.value = true
    scanner = createScanner({ elementId })

    scanner.start(async (decodedText) => {
      const barcode = decodedText?.trim()
      if (!barcode) return
      if (onScanSuccess) await onScanSuccess(barcode)
      stopScanner()
      if (onScanComplete) onScanComplete()
    }, {})
  }

  function stopScanner() {
    if (scanner) {
      scanner.stop()
      isScanning.value = false
    }
  }

  function cleanupScanner() {
    if (scanner) {
      scanner.cleanup()
      scanner = null
    }
    isScanning.value = false
  }

  async function handleTsdInput(processBarcode) {
    if (isProcessingTsd.value) return
    const input = tsdInput.value?.trim()
    if (!input) return

    isProcessingTsd.value = true

    const { parseBarcodeToBrainNumber, ensurePrefix } = await import('@/utils/barcode')
    const barcode = ensurePrefix(parseBarcodeToBrainNumber(input))

    if (!barcode) {
      window.showToast(`Неверный формат: ${input}`)
      isProcessingTsd.value = false
      tsdInput.value = ''
      return
    }

    const cb = processBarcode || options.onScanSuccess
    if (cb) await cb(barcode)

    tsdInput.value = ''
    nextTick(() => {
      isProcessingTsd.value = false
    })
  }

  return {
    isScanning,
    scannerElementId: elementId,
    startScanner,
    stopScanner,
    cleanupScanner,
    scanMode,
    tsdInput,
    isProcessingTsd,
    handleTsdInput
  }
}
