import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { parseBarcodeToBrainNumber, ensurePrefix } from '@/utils/barcode'
import { syncBrainItems, loadBrainItemsFromBackend, deleteBrainItemsFromBackend } from '@/utils/sync'
import { auth } from '@/lib/api.js'
import { isAdmin } from '@/config'

/**
 * Store для управления базой бракованных товаров
 * Данные загружаются из Excel и сохраняются в localStorage
 * Интегрировано с бэкендом для синхронизации между устройствами
 */
export const useBrainStore = defineStore('brain', () => {
  // База товаров из Excel
  const items = ref([])

  // Маппинг колонок (какая колонка Excel соответствует какому полю)
  const columnMapping = ref({
    number: null,
    name: null,
    article: null,
    comment: null
  })

  // Статус синхронизации
  const isSyncing = ref(false)
  const syncError = ref(null)

  // Статус загрузки
  const isLoading = ref(false)
  const loadError = ref(null)

  // Вычисляемое: количество товаров в базе
  const totalItems = computed(() => items.value.length)

  // Вычисляемое: есть ли загруженная база
  const hasDatabase = computed(() => items.value.length > 0)

  /**
   * Загрузка данных из распарсенного Excel
   */
  async function setDatabase(data, mapping) {
    items.value = data.map((item, index) => {
      let number = String(item[mapping.number] || '').trim()
      // Нормализуем номер: добавляем префикс 187/ если нет
      number = ensurePrefix(number)
      
      const nameVal = (item[mapping.name] || 'Без названия')?.toString().trim()
      return {
        id: index,
        number,
        name: nameVal || 'Без названия',  // Fallback на "Без названия" если пусто после trim
        article: String(item[mapping.article] || '').trim(),
        comment: mapping.comment ? String(item[mapping.comment] || '').trim() : ''
      }
    })
    columnMapping.value = mapping

    // Получаем employeeId пользователя для синхронизации
    const userId = auth.getUserId()

    // Синхронизация с бэкендом (в фоне, не блокирует UI)
    isSyncing.value = true
    syncError.value = null
    try {
      await syncBrainItems(items.value, mapping, userId)
    } catch (error) {
      syncError.value = 'Не удалось синхронизировать с сервером. Данные сохранены локально.'
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Загрузка базы из бэкенда при инициализации
   */
  async function loadFromBackend() {
    isLoading.value = true
    loadError.value = null
    try {
      const data = await loadBrainItemsFromBackend()
      if (data && data.length > 0) {
        items.value = data.map((item, index) => {
          let number = item.number || ''
          number = ensurePrefix(number)
          return {
            id: index,
            number: String(number),
            name: (item.name || '').trim() || 'Без названия',  // Fallback на "Без названия" если пусто
            article: item.article || '',
            comment: item.comment || ''
          }
        })
        columnMapping.value = {
          number: 'number',
          name: 'name',
          article: 'article',
          comment: 'comment'
        }
      } else {
        items.value = []
      }
    } catch (error) {
      loadError.value = 'Не удалось загрузить с сервера. Используем локальные данные.'
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Поиск товара по номеру этикетки брака
   */
  function findByBarcode(barcode) {
    if (!barcode) return null

    const parsedBarcode = parseBarcodeToBrainNumber(barcode.trim())
    if (!parsedBarcode) return null

    // Сначала ищем по number (barcode)
    let foundItem = items.value.find(item => item.number === parsedBarcode) || null
    
    // Fallback: если не нашли по number — ищем по article (коду товара)
    if (!foundItem && barcode.trim()) {
      foundItem = items.value.find(item => {
        const normalizedArticle = parseBarcodeToBrainNumber(item.article) || item.article
        return normalizedArticle && normalizedArticle === parsedBarcode
      }) || null
    }
    
    return foundItem
  }

  /**
   * Очистка базы данных (только админ может очистить серверную базу)
   */
  async function clearDatabase() {
    const adminCheck = isAdmin()

    if (!adminCheck) {
      // BUG-230 fix: не-админ не может очистить базу без подтверждения
      if (!window.confirm('Очистить локальную базу данных?')) {
        return { success: false, clearedLocal: false, clearedBackend: false }
      }
      items.value = []
      columnMapping.value = { number: null, name: null, article: null, comment: null }
      return { success: true, clearedLocal: true, clearedBackend: false }
    }

    items.value = []
    columnMapping.value = { number: null, name: null, article: null, comment: null }

    try {
      await deleteBrainItemsFromBackend()
      return { success: true, clearedLocal: true, clearedBackend: true }
    } catch (error) {
      return { success: false, error: error.message, clearedLocal: true, clearedBackend: false }
    }
  }

  /**
   * Проверка на стоп-товар
   */
  function isStopItem(item) {
    if (!item) return false
    const comment = String(item.comment ?? '').trim().toLowerCase()
    if (comment === '') return false
    const stopKeywords = ['не согласован', 'ждем согласования', 'ждем решения']
    return stopKeywords.some(keyword => comment.includes(keyword))
  }

  return {
    items,
    columnMapping,
    totalItems,
    hasDatabase,
    isSyncing,
    syncError,
    isLoading,
    loadError,
    setDatabase,
    loadFromBackend,
    findByBarcode,
    clearDatabase,
    isStopItem
  }
}, {
  // server-first: данные только с сервера, localStorage не используется для бизнес-данных
})
