/**
 * Преобразует штрихкод со сканера в номер этикетки брака
 *
 * Формат штрихкода: Z018700453282
 * Формат в БД: 187/45328
 *
 * Логика:
 * - Z + 0 + 187 + 00 + 45328 = Z018700453282
 * - 187 = цифры с позиции 2 по 4 (после Z0)
 * - 45328 = последние 5 цифр
 *
 * @param {string} barcode - штрихкод со сканера
 * @returns {string|null} номер этикетки в формате БД или null
 */
export function parseBarcodeToBrainNumber(barcode) {
  if (!barcode) return null

  let cleaned = barcode.trim().toUpperCase()

  // Кириллическая «Я»
  cleaned = cleaned.replace(/^Я/, 'Z')

  // Если уже в формате 187/45202
  if (/^\d+\/\d+$/.test(cleaned)) {
    return cleaned
  }

  // Если просто номер без префикса
  if (/^\d+$/.test(cleaned) && cleaned.length >= 4 && cleaned.length <= 6) {
    return `187/${cleaned}`
  }

  // Убираем букву Z в начале
  if (cleaned.startsWith('Z')) {
    cleaned = cleaned.slice(1)
  }

  // Проверяем, что остались только цифры
  if (!/^\d+$/.test(cleaned)) {
    return null
  }

  const len = cleaned.length

  if (len === 12) {
    return `${cleaned.slice(1, 4)}/${cleaned.slice(6, 11)}`
  }

  // Длины 10/11/13 однозначно не ложатся на формат 187/NNNNN: прежние ветки
  // возвращали мусор вида «870/5328» или «187/<13 цифр», guard «Неверный формат»
  // не срабатывал и в контейнер записывался фантомный товар с невалидным номером.
  // Лучше отклонить код, чем принять неверный номер.
  return null
}

/**
 * Проверяет соответствие штрихкода номеру в БД
 * @param {string} scannedBarcode - штрихкод со сканера
 * @param {string} dbNumber - номер из БД (например, "187/45328")
 * @returns {boolean}
 */
export function isBarcodeMatch(scannedBarcode, dbNumber) {
  const parsed = parseBarcodeToBrainNumber(scannedBarcode)
  if (!parsed) return false

  // Сравниваем с номером в БД
  return parsed === dbNumber
}

/**
 * Добавляет префикс 187/ если он отсутствует
 * @param {string} number - Номер без префиintex или с ним
 * @returns {string} Нормализованный номер с префикfmt
 */
export function ensurePrefix(number) {
  if (!number) return ''
  const str = String(number).trim()
  if (str && !/^187\//i.test(str)) {
    return `187/${str}`
  }
  return str
}
