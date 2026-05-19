import { db, auth } from '@/lib/api.js'

/* ============================================================
   Warehouse Brain — utils/sync (server-first)
   
   Убран SyncQueueManager: все данные хранятся на сервере.
   Оставлено: только ScanBatchManager для пакетной отправки сканов.
============================================================ */

// Ключ для очереди пакетной отправки сканирований
const SCAN_BATCH_QUEUE_KEY = 'backend-scan-batch-queue'

// Настройки пакетной отправки сканирований
const SCAN_BATCH_SIZE = 20 // Отправлять пакетом по 20 сканов
const SCAN_BATCH_INTERVAL = 30000 // Или каждые 30 секунд

/* ============================================================
   Mojibake fix — декодирование русских символов из WIN1251 → UTF-8
============================================================ */

/** Декодирует mojibake (UTF-8 байты, интерпретированные как Windows-1251) в правильный текст */
function decodeMojibake(text) {
  if (!text || typeof text !== 'string') return text

  // Проверяем есть ли mojibake (типичные символы: ╨, ╤, etc.)
  const hasMojibake = /[╨╤]/.test(text)
  if (!hasMojibake) return text

  try {
    // В браузере TextEncoder поддерживает только UTF-8.
    // Для mojibake recovery: каждый символ mojibake — это байт UTF-8,
    // интерпретированный через Windows-1251. Конвертируем code points обратно в байты.
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      // Windows-1251: символы 0x80-0xFF маппятся на те же code points
      bytes[i] = code > 0xff ? 0x3f : code // fallback на '?' если超出 диапазона
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return decoder.decode(bytes)
  } catch {
    // Если не работает — возвращаем оригинал
    return text
  }
}

/* ============================================================
   ScanBatchManager — пакетная отправка сканов
============================================================ */

class ScanBatchManager {
  constructor() {
    this.batch = []
    this.timer = null
    this.retryTimer = null
    this.retryCount = 0
    const MAX_RETRY_DELAY = 60000 // max 1 minute between retries
    this.MAX_RETRY_DELAY = MAX_RETRY_DELAY
    this.loadSavedBatch()
  }

  loadSavedBatch() {
    try {
      const saved = localStorage.getItem(SCAN_BATCH_QUEUE_KEY)
      if (saved) {
        this.batch = JSON.parse(saved)
        if (this.batch.length > 0 && !this.timer) {
          this.timer = setTimeout(() => this.flush(), SCAN_BATCH_INTERVAL)
        }
      }
    } catch (err) {
      console.error('[sync] loadBatch: failed to restore queue from localStorage:', err)
    }
  }

  saveBatch() {
    try {
      localStorage.setItem(SCAN_BATCH_QUEUE_KEY, JSON.stringify(this.batch))
    } catch (err) {
      console.error('[sync] saveBatch: failed to persist queue:', err)
    }
  }

  add(scanData) {
    this.batch.push({ ...scanData, created_at: new Date().toISOString() })
    this.saveBatch()

    if (this.batch.length >= SCAN_BATCH_SIZE) {
      this.flush()
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), SCAN_BATCH_INTERVAL)
    }
  }

  async flush() {
    if (this.batch.length === 0) return
    clearTimeout(this.timer)
    this.timer = null

    try {
      await db.scanHistory.logBatch(this.batch)

      // BUG-10 fix: очищаем batch ТОЛЬКО после успешной отправки
      this.batch = []
      this.retryCount = 0
      this.saveBatch()
    } catch (error) {
      // BUG-10 fix: backoff retry вместо потери batch
      this.retryCount++
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), this.MAX_RETRY_DELAY)

      // Не очищаем batch! Оставляем для retry.
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, delay)
    }
  }

  clear() {
    this.batch = []
    this.retryCount = 0
    clearTimeout(this.timer)
    this.timer = null
    this.saveBatch()
  }

  /** Получить последний скан для barcode из локального батча */
  getLastScan(barcode) {
    // Ищем все сканы с этим barcode и берём самый свежий
    const matchingScans = this.batch
      .filter((s) => s.barcode === barcode)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    if (matchingScans.length > 0 && matchingScans[0].created_at) {
      return new Date(matchingScans[0].created_at).toISOString()
    }
    return null
  }
}

export const scanBatchManager = new ScanBatchManager()

/* ============================================================
   High-level sync functions — brain items (единственный источник правды)
============================================================ */

/** Синхронизация базы brain items на сервере */
export async function syncBrainItems(items, columnMapping, uploaderEmployeeId = null) {
  const userId = auth.getUserId()
  if (!userId || !navigator.onLine) return

  try {
    const rows = items.map((item) => ({
      barcode: item.number,
      name: item.name,
      brand: item.article || '',
      model: '',
      defect_type: '',
      comment: item.comment || ''
    }))

    await db.brainItems.import({ rows })
  } catch (error) {}
}

/** Загрузка базы brain items с бэкенда */
export async function loadBrainItemsFromBackend() {
  const userId = auth.getUserId()
  if (!userId || !navigator.onLine) return null

  try {
    const result = await db.brainItems.getAll()
    if (result.error) throw new Error(result.error.message)
    return (result.data || []).map((item) => ({
      number: item.barcode,
      name: decodeMojibake((item.name || '').trim()) || 'Без названия', // Fallback на "Без названия" если пусто + mojibake fix
      article: decodeMojibake(item.brand || ''),
      comment: decodeMojibake(item.comment || '')
    }))
  } catch (error) {
    return null
  }
}

/** Удаление всей базы brain items с бэкенда */
export async function deleteBrainItemsFromBackend() {
  const userId = auth.getUserId()
  if (!userId) throw new Error('Нет авторизации')

  try {
    await db.brainItems.clearAll()
    return { success: true }
  } catch (error) {
    throw error
  }
}

/** Логирование одного скана (для scan_history) */
export function logScan(scanData) {
  try {
    scanBatchManager.add({
      barcode: scanData.barcode || scanData.itemNumber,
      itemNumber: scanData.itemNumber,
      itemName: scanData.itemName,
      action: scanData.action || 'scan',
      boxId: scanData.boxId || null,
      collector_id: auth.getUserId()
    })
  } catch (err) {
    if (typeof window.showToast === 'function') {
      window.showToast('Ошибка сохранения скана')
    }
  }
}

/** Загрузка separate items с бэкенда */
export async function loadSeparateItemsFromBackend() {
  const userId = auth.getUserId()
  if (!userId || !navigator.onLine) return []

  try {
    const result = await db.separateItems.getAll()
    if (result.error) throw new Error(result.error.message)
    return result.data || []
  } catch (error) {
    return []
  }
}

/** Синхронизация отдельного товара на сервере */
export async function syncSeparateItem(item) {
  const userId = auth.getUserId()
  if (!userId || !navigator.onLine) return null

  try {
    await db.separateItems.add({
      barcode: item.number,
      name: item.name,
      brand: item.article || '',
      model: '',
      defect_type: '',
      comment: item.comment || ''
    })
    return { success: true }
  } catch (error) {
    return null
  }
}
