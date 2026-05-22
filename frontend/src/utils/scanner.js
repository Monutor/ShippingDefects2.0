import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'

/**
 * Класс-обёртка для работы со сканером штрихкодов
 */
export class BarcodeScanner {
  constructor() {
    this.scanner = null
    this.isScanning = false
    this.torchOn = false
  }

  /**
   * Инициализация сканера
   * @param {string} elementId - ID DOM-элемента для рендеринга сканера
   */
  init(elementId) {
    // Очищаем предыдущий сканер если есть
    if (this.scanner) {
      this.scanner.clear()
    }
    this.scanner = new Html5Qrcode(elementId)
  }

  /**
   * Запуск сканирования
   * @param {Function} onScanSuccess - callback при успешном сканировании
   * @param {Object} config - конфигурация сканера
   * @returns {Promise}
   */
  async start(onScanSuccess, config = {}) {
    if (this.isScanning) {
      throw new Error('Сканирование уже запущено')
    }

    const defaultConfig = {
      fps: 25,
      qrbox: { width: 300, height: 300 },
      aspectRatio: 1.0,
      disableFlip: false,
      showTorchButtonIfSupported: true,
      formats: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.QR_CODE
      ]
    }

    const mergedConfig = { ...defaultConfig, ...config }

    try {
      // BUG-232 fix: проверяем инициализацию в начале start()
      if (!this.scanner) {
        throw new Error('Сканер не инициализирован — вызовите init() перед start()')
      }

      // Запускаем сканирование с использованием задней камеры
      await this.scanner.start(
        { facingMode: 'environment' },
        mergedConfig,
        (decodedText, decodedResult) => {
          // Останавливаем сканирование после успешного чтения
          this.stop()
          onScanSuccess(decodedText, decodedResult)
        },
        (errorMessage) => {}
      )
      this.isScanning = true

      try {
        const caps = this.scanner.getRunningTrackCapabilities()
        this._torchSupported = !!caps.torch
      } catch {
        this._torchSupported = false
      }
    } catch (error) {
      // Пробуем альтернативный способ - по deviceId
      if (error.message?.includes('Permission') || error.message?.includes('NotAllowed')) {
        throw new Error('Нет доступа к камере. Разрешите доступ в настройках браузера.')
      }
      if (error.message?.includes('HttpsRequired') || error.message?.includes('SecureContext')) {
        throw new Error('Требуется HTTPS. Откройте приложение по HTTPS или localhost.')
      }
      throw error
    }
  }

  /**
   * Остановка сканирования
   * @returns {Promise}
   */
  async stop() {
    if (!this.isScanning || !this.scanner) {
      return
    }

    try {
      await this.scanner.stop()
      this.isScanning = false
    } catch (error) {
      this.isScanning = false
    }
  }

  /**
   * Получение возможностей камеры (capabilities)
   * @returns {Promise<Object|null>}
   */
  async getCameraCapabilities() {
    if (!this.scanner || !this.isScanning) return null
    try {
      return this.scanner.getRunningTrackCapabilities()
    } catch {
      return null
    }
  }

  /**
   * Переключение фонарика (torch)
   * @returns {Promise<boolean>} — новое состояние (true = включён)
   */
  async toggleTorch() {
    if (!this.scanner || !this.isScanning) return false
    try {
      const capabilities = await this.getCameraCapabilities()
      if (!capabilities?.torch) return false
      this.torchOn = !this.torchOn
      await this.scanner.applyVideoConstraints({ advanced: [{ torch: this.torchOn }] })
      return this.torchOn
    } catch {
      this.torchOn = false
      return false
    }
  }

  /**
   * Очистка ресурсов
   */
  async cleanup() {
    if (this.scanner) {
      try {
        if (this.isScanning) {
          await this.scanner.stop()
        }
        await this.scanner.clear()
      } catch (error) {}
      this.scanner = null
      this.isScanning = false
    }
  }
}

/**
 * Фабричная функция для создания экземпляра сканера
 * @param {string|Object} options - ID элемента или объект { elementId }
 * @returns {BarcodeScanner}
 */
export function createScanner(options) {
  const scanner = new BarcodeScanner()

  if (typeof options === 'string') {
    scanner.init(options)
  } else {
    scanner.init(options.elementId)
  }

  return scanner
}

/**
 * Проверка поддержки камеры браузером
 * @returns {Promise<boolean>}
 */
export async function checkCameraSupport() {
  // BUG-233 fix: разрешаем http://192.168.*.* для локальной сети
  const isLocalNetwork = window.location.hostname.match(/^192\.168\.\d+\.\d+$/)
  if (
    window.location.protocol !== 'https:' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    !isLocalNetwork
  ) {
    return false
  }

  // Проверка наличия getUserMedia
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false
  }

  // Пробуем получить доступ к камере
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch {
    return false
  }
}
