import { ref, nextTick } from 'vue'
import { createScanner, checkCameraSupport, getAvailableCameras } from '@/utils/scanner'

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

  const flashlight = ref(false)
  const torchSupported = ref(false)
  const scanFlashBounds = ref(null)

  const cameras = ref([])
  const selectedCameraId = ref(null)

  async function fetchCameras() {
    const list = await getAvailableCameras()
    cameras.value = list
    if (list.length > 0 && !selectedCameraId.value) {
      const back = list.find((d) => /back|environment|rear/i.test(d.label))
      selectedCameraId.value = back ? back.deviceId : list[0].deviceId
    }
  }

  const scanMode = ref('tsd')
  const tsdInput = ref('')
  const isProcessingTsd = ref(false)

  // Буфер скрытого readonly-поля для HID-пикания ТСД (DataWedge). Символы
  // поступают автоматически, без ввода пальцем и закрытия клавиатуры.
  const tsdCapture = ref('')
  let tsdCaptureTimer = null

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

    try {
      let lastBarcode = ''
      await scanner.start(
        async (decodedText, _decodedResult) => {
          const barcode = decodedText?.trim()
          if (!barcode || barcode === lastBarcode) return
          lastBarcode = barcode

          try {
            const upper = barcode.toUpperCase()
            if (upper.startsWith('Z') && upper.length < 13) {
              if (navigator.vibrate) navigator.vibrate(100)
              window.showToast('Штрихкод повреждён, повторите')
              return
            }

            scanFlashBounds.value = {
              left: '0',
              width: '100%',
              top: '50%',
              height: '50px',
              transform: 'translateY(-50%)'
            }

            turnOffFlashlight()
            await new Promise((resolve) => setTimeout(resolve, 300))
            scanFlashBounds.value = null
            if (onScanSuccess) await onScanSuccess(barcode)
            stopScanner()
            if (onScanComplete) onScanComplete()
          } catch (err) {
            // Сбрасываем lastBarcode, чтобы повторное сканирование сработало
            lastBarcode = ''
            window.showToast(err.message || 'Ошибка обработки скана')
          }
        },
        { deviceId: selectedCameraId.value }
      )
      torchSupported.value = !!scanner._torchSupported
    } catch (err) {
      window.showToast(err.message || 'Ошибка запуска камеры')
      isScanning.value = false
    }
  }

  function stopScanner() {
    if (scanner) {
      scanner.stop()
      isScanning.value = false
      flashlight.value = false
    }
  }

  function turnOffFlashlight() {
    if (flashlight.value && scanner) {
      scanner.toggleTorch()
      flashlight.value = false
    }
  }

  async function toggleFlashlight() {
    if (!scanner || !isScanning.value) return
    const result = await scanner.toggleTorch()
    flashlight.value = !!result
  }

  function cleanupScanner() {
    if (scanner) {
      scanner.cleanup()
      scanner = null
    }
    isScanning.value = false
    if (tsdCaptureTimer) {
      clearTimeout(tsdCaptureTimer)
      tsdCaptureTimer = null
    }
  }

  // Общий конвейер обработки сырого штрихкода из ТД-ввода (ручной ввод и
  // скрытое поле для пикания). Возвращает true, если код передан в обработчик,
  // и false — если отклонён. Проверка повреждённых кодов дублирует startScanner:
  // Z + меньше 13 символов → «Штрихкод повреждён».
  async function processRawBarcode(rawValue, processBarcode) {
    const input = rawValue?.trim()
    if (!input) return false

    const upperInput = input.toUpperCase()
    if (upperInput.startsWith('Z') && upperInput.length < 13) {
      if (navigator.vibrate) navigator.vibrate(100)
      window.showToast('Штрихкод повреждён, повторите')
      return false
    }

    const { parseBarcodeToBrainNumber, ensurePrefix } = await import('@/utils/barcode')
    const barcode = ensurePrefix(parseBarcodeToBrainNumber(input))

    if (!barcode) {
      window.showToast(`Неверный формат: ${input}`)
      return false
    }

    const cb = processBarcode || options.onScanSuccess
    if (cb) await cb(barcode)
    return true
  }

  async function handleTsdInput(processBarcode) {
    if (isProcessingTsd.value) return
    const input = tsdInput.value?.trim()
    if (!input) return

    isProcessingTsd.value = true
    await processRawBarcode(input, processBarcode)
    tsdInput.value = ''
    nextTick(() => {
      isProcessingTsd.value = false
    })
  }

  // Скрытое readonly-поле: пишем символ в буфер и жём паузу ~80 мс. Так
  // пиканье срабатывает без ввода пальцем — DataWedge HID сам доставляет код.
  function onTsdCaptureInput(event) {
    tsdCapture.value = event.target?.value ?? ''
    if (tsdCaptureTimer) clearTimeout(tsdCaptureTimer)
    tsdCaptureTimer = setTimeout(() => {
      tsdCaptureTimer = null
      void finishTsdCapture()
    }, 80)
  }

  async function finishTsdCapture() {
    const input = tsdCapture.value?.trim()
    if (!input) return
    // Очищаем буфер до обработки, чтобы повторное пикание не считалось дублем.
    tsdCapture.value = ''
    if (tsdCaptureTimer) {
      clearTimeout(tsdCaptureTimer)
      tsdCaptureTimer = null
    }
    await processRawBarcode(input, options.onScanSuccess)
  }

  function focusTsdCapture() {
    const el = document.getElementById('tsd-capture-input')
    if (el) {
      try {
        el.focus()
      } catch {
        // Мобильные браузеры иногда блокируют программный фокус без жеста.
      }
    }
  }

  function blurTsdCapture() {
    const el = document.getElementById('tsd-capture-input')
    if (el) {
      try {
        el.blur()
      } catch {
        // Мобильные браузеры иногда блокируют blur без жеста.
      }
    }
  }

  return {
    isScanning,
    scannerElementId: elementId,
    startScanner,
    stopScanner,
    cleanupScanner,
    scanMode,
    tsdInput,
    tsdCapture,
    isProcessingTsd,
    handleTsdInput,
    processRawBarcode,
    onTsdCaptureInput,
    finishTsdCapture,
    focusTsdCapture,
    blurTsdCapture,
    flashlight,
    torchSupported,
    scanFlashBounds,
    toggleFlashlight,
    cameras,
    selectedCameraId,
    fetchCameras
  }
}
