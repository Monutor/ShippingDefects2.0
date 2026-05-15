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

/** Декодирует mojibake (WIN1251 интерпретация UTF-8) в правильный текст */
function decodeMojibake(text) {
  if (!text || typeof text !== 'string') return text
  
  // Проверяем есть ли mojibake (типичные символы: ╨, ╤, etc.)
  const hasMojibake = /[╨╤]/.test(text)
  if (!hasMojibake) return text
  
  try {
    // Кодируем строку как Windows-1251 (как она была интерпретирована)
    const encoder = new TextEncoder('windows-1251')
    const bytes = encoder.encode(text)
    
    // Декодируем обратно как UTF-8
    const decoder = new TextDecoder('utf-8')
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
    } catch {}
  }

  saveBatch() {
    try { localStorage.setItem(SCAN_BATCH_QUEUE_KEY, JSON.stringify(this.batch)) } catch {}
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
      console.log(`📡 Отправлен пакет сканирований: ${this.batch.length}`)

      // BUG-10 fix: очищаем batch ТОЛЬКО после успешной отправки (было — до отправки в catch, приводило к потере данных)
      this.batch = []
      this.retryCount = 0  // сбрасываем счётчик retry при успехе
      this.saveBatch()
    } catch (error) {
      console.warn('⚠️ Не удалось отправить пакет сканов:', error.message)

      // BUG-10 fix: backoff retry вместо потери batch. Timer не убиваем — перепланируем с увеличенным интервалом.
      this.retryCount++
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), this.MAX_RETRY_DELAY)
      console.log(`🔄 Retry через ${delay}ms (попытка ${this.retryCount})`)

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
    const matchingScans = this.batch.filter(s => s.barcode === barcode).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
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
    const rows = items.map(item => ({
      barcode: item.number,
      name: item.name,
      brand: item.article || '',
      model: '',
      defect_type: '',
      comment: item.comment || ''
    }))

    await db.brainItems.import({ rows })
    console.log(`✅ База синхронизирована: ${rows.length} товаров`)
  } catch (error) {
    console.error('Ошибка синхронизации brain items:', error)
  }
}

/** Загрузка базы brain items с бэкенда */
export async function loadBrainItemsFromBackend() {
  const userId = auth.getUserId()
  if (!userId || !navigator.onLine) return null

  try {
    const result = await db.brainItems.getAll()
    if (result.error) throw new Error(result.error.message)
    return (result.data || []).map(item => ({
      number: item.barcode,
      name: decodeMojibake((item.name || '').trim()) || 'Без названия',  // Fallback на "Без названия" если пусто + mojibake fix
      article: decodeMojibake(item.brand || ''),
      comment: decodeMojibake(item.comment || '')
    }))
  } catch (error) {
    console.error('Ошибка загрузки brain items:', error)
    return null
  }
}

/** Удаление всей базы brain items с бэкенда */
export async function deleteBrainItemsFromBackend() {
  const userId = auth.getUserId()
  if (!userId) throw new Error('Нет авторизации')

  try {
    await db.brainItems.clearAll()
    console.log('🗑 База brain items удалена с бэкенда')
    return { success: true }
  } catch (error) {
    console.error('Ошибка удаления brain items:', error)
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
    console.error('Ошибка логирования скана:', err)
    if (typeof window.showToast === 'function') {
      window.showToast(`⚠️ Ошибка сохранения скана: ${err.message}`)
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
    return (result.data || [])
  } catch (error) {
    console.error('Ошибка загрузки separate items:', error)
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
    console.log(`✅ Отдельный товар синхронизирован:`, item.number)
    return { success: true }
  } catch (error) {
    console.error('Ошибка синхронизации separate item:', error)
    return null
  }
}
