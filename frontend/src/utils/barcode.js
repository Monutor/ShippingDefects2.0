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
  console.log('🔍 parseBarcodeToBrainNumber input:', JSON.stringify(barcode), '→', JSON.stringify(cleaned))

  // Кириллическая «Я» (русская раскладка, клавиша Z) → латинская «Z»
  cleaned = cleaned.replace(/^Я/, 'Z')

  // Если уже в формате 187/45202 - возвращаем как есть
  if (/^\d+\/\d+$/.test(cleaned)) {
    console.log('✅ format 187/XXXX detected:', cleaned)
    return cleaned
  }

  // Если просто номер без префикса (например "45328") — добавляем 187/
  // Это для ручного ввода через ТСД когда пользователь знает только номер товара
  if (/^\d+$/.test(cleaned) && cleaned.length >= 4 && cleaned.length <= 6) {
    const result = `187/${cleaned}`
    console.log('✅ simple number detected, returning:', result)
    return result
  }

  // Убираем букву Z в начале
  if (cleaned.startsWith('Z')) {
    cleaned = cleaned.slice(1)
  }

  // Проверяем, что остались только цифры
  if (!/^\d+$/.test(cleaned)) {
    console.log('❌ not all digits after removing Z')
    return null
  }

  // Работаем с исходной строкой (без удаления ведущих нулей) — позиционный анализ по длине
  // Формат: Z + категория(1) + part1(N) + разделитель(00) + part2(M)
  // Пример: Z01870045328 → 0+187+00+4532 (11 цифр после Z)
  //         Z018700453282 → 0+187+00+45328 (12 цифр после Z)
  const len = cleaned.length
  console.log('🔍 after Z removal, length:', len, 'cleaned:', cleaned)

  if (len === 12) {
    // категория(1) + part1(3) + разделитель(00) + part2(5)
    return `${cleaned.slice(1, 4)}/${cleaned.slice(6, 11)}`
  }

  if (len === 11) {
    // категория(1) + part1(3) + разделитель(00) + part2(4)
    return `${cleaned.slice(1, 4)}/${cleaned.slice(6, 10)}`
  }

  if (len === 10) {
    // категория(1) + part1(3) + разделитель(00) + part2(5)
    return `${cleaned.slice(1, 4)}/${cleaned.slice(6, 11)}`
  }

  // 13 цифр — EAN-13 или аналог: добавляем 187/ к исходному номеру
  if (len === 13) {
    const result = `187/${cleaned}`
    console.log('✅ EAN-13 detected, returning:', result)
    return result
  }

  // Если длина не совпадает, возвращаем null (не распознано)
  console.log('❌ unknown length:', len)
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
