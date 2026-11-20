// Номер текущего магазина («NNN»), инжектируется из storeProfile
// (loadStoreProfile/setStoreProfile). null — профиль не настроен (S000).
let storeNumber = null

export function setStoreNumber(number) {
  storeNumber = typeof number === 'string' && /^\d{3}$/.test(number) ? number : null
}

function requireStore() {
  if (!storeNumber) {
    throw new Error('Магазин не настроен — укажите магазин в Настройках')
  }
}

// NNN из номера «NNN/NNNNN» или null
function storeOf(number) {
  const m = /^(\d{3})\/\d+$/.exec(String(number))
  return m ? m[1] : null
}

function assertOwnStore(number) {
  const seg = storeOf(number)
  if (seg && storeNumber && seg !== storeNumber) {
    throw new Error(`Штрихкод магазина S${seg} — текущий профиль S${storeNumber}`)
  }
}

/**
 * Преобразует штрихкод со сканера в номер этикетки брака с учётом
 * профиля текущего магазина.
 *
 * Формат штрихкода: Z0{NNN}00{XXXXX} (NNN — номер текущего магазина)
 * Формат в БД: {NNN}/{XXXXX}
 *
 * Логика:
 * - Z + 0 + NNN + 00 + XXXXX — 12 цифр после Z
 * - NNN = цифры с позиции 2 по 4 (после Z0) — номер магазина
 * - XXXXX = последние 5 цифр
 *
 * @throws {Error} профиль не настроен или код чужого магазина
 * @param {string} barcode - штрихкод со сканера
 * @returns {string|null} номер этикетки в формате БД или null
 */
export function parseBarcodeToBrainNumber(barcode) {
  if (!barcode) return null

  let cleaned = barcode.trim().toUpperCase()

  // Кириллическая «Я»
  cleaned = cleaned.replace(/^Я/, 'Z')

  // Если уже в формате NNN/XXXXX — проверяем магазин
  if (/^\d+\/\d+$/.test(cleaned)) {
    assertOwnStore(cleaned)
    return cleaned
  }

  // Если просто номер без префикса — префикс из профиля магазина
  if (/^\d+$/.test(cleaned) && cleaned.length >= 4 && cleaned.length <= 6) {
    requireStore()
    return `${storeNumber}/${cleaned}`
  }

  // Убираем букву Z в начале
  if (cleaned.startsWith('Z')) {
    cleaned = cleaned.slice(1)
  }

  // Проверяем, что остались только цифры
  if (/^\d+$/.test(cleaned)) {
    requireStore()

    if (cleaned.length === 12) {
      const result = `${cleaned.slice(1, 4)}/${cleaned.slice(6, 11)}`
      assertOwnStore(result)
      return result
    }

    // Длины 10/11/13 однозначно не ложатся на формат NNN/NNNNN: прежние ветки
    // возвращали мусор вида «870/5328» или «NNN/<13 цифр», guard «Неверный формат»
    // не срабатывал и в контейнер записывался фантомный товар с невалидным номером.
    // Лучше отклонить код, чем принять неверный номер.
    return null
  }

  return null
}

/**
 * Проверяет соответствие штрихкода номеру в БД
 * @param {string} scannedBarcode - штрихкод со сканера
 * @param {string} dbNumber - номер из БД (например, "NNN/XXXXX")
 * @returns {boolean}
 */
export function isBarcodeMatch(scannedBarcode, dbNumber) {
  const parsed = parseBarcodeToBrainNumber(scannedBarcode)
  if (!parsed) return false

  // Сравниваем с номером в БД
  return parsed === dbNumber
}

/**
 * Добавляет префикс текущего магазина если он отсутствует.
 * Если профиль не настроен — номер возвращается без изменений.
 * @throws {Error} номер принадлежит чужому магазину
 * @param {string} number - номер с префиксом или без
 * @returns {string} нормализованный номер с префиксом магазина
 */
export function ensurePrefix(number) {
  if (!number) return ''
  const str = String(number).trim()
  if (!storeNumber) return str
  const seg = /^(\d{3})\//.exec(str)
  if (seg && seg[1] !== storeNumber) {
    throw new Error(`Штрихкод магазина S${seg[1]} — текущий профиль S${storeNumber}`)
  }
  if (/^\d{3}\//.test(str)) {
    return str
  }
  return `${storeNumber}/${str}`
}
