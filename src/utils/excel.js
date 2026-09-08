import * as XLSX from 'xlsx'
import Excel from 'exceljs'
import { dbStore as db } from '@/lib/db.js'

/**
 * Читает Excel файл и возвращает сырые данные
 * @param {File} file - файл Excel
 * @returns {Promise<Array>} массив объектов из первого листа
 */
export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })

        // Берём первый лист
        const firstSheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[firstSheetName]

        // Конвертируем в JSON (массив объектов)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' })

        resolve(jsonData)
      } catch (error) {
        reject(new Error(`Ошибка чтения Excel: ${error.message}`))
      }
    }

    reader.onerror = () => {
      reject(new Error('Ошибка чтения файла'))
    }

    reader.readAsArrayBuffer(file)
  })
}

/**
 * Извлекает уникальные заголовки колонок из данных
 * @param {Array} data - массив объектов
 * @returns {Array} массив названий колонок
 */
export function getColumnHeaders(data) {
  if (!data || data.length === 0) return []

  // Собираем все уникальные ключи из всех объектов
  const headers = new Set()
  data.forEach((item) => {
    Object.keys(item).forEach((key) => headers.add(key))
  })

  return Array.from(headers)
}

/**
 * Экспорт данных в Excel файл
 * @param {Array} data - массив объектов для экспорта
 * @param {string} filename - имя файла (без расширения)
 */
export function exportToExcel(data, filename) {
  try {
    // Создаём новый workbook
    const workbook = XLSX.utils.book_new()

    // Конвертируем данные в worksheet
    const worksheet = XLSX.utils.json_to_sheet(data)

    // Добавляем worksheet в workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Товары')

    // Генерируем имя файла с датой
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const fullName = `${filename}_${timestamp}.xlsx`

    // Скачиваем файл
    XLSX.writeFile(workbook, fullName)

    return { success: true, filename: fullName }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Дублирует блок строк 1..endRow того же листа ниже (для второй пломбы на короб).
 * Копируются значения, стили, высоты строк и мёрджи. Между копиями — строка
 * «линия разреза». ВАЖНО: при добавлении строк в пломбу обнови endRow в вызове.
 */
function duplicateSheetBlock(sheet, endRow, gapRows = 3) {
  const dstStart = endRow + gapRows + 1
  const colCount = sheet.columnCount || 2

  const cutRowNum = endRow + 1
  sheet.mergeCells(`A${cutRowNum}:B${cutRowNum}`)
  const cutCell = sheet.getCell(`A${cutRowNum}`)
  cutCell.value = '✂ линия разреза'
  cutCell.font = { italic: true, size: 9, color: { argb: 'FF999999' } }
  cutCell.alignment = { horizontal: 'center', vertical: 'middle' }

  for (let r = 1; r <= endRow; r++) {
    const src = sheet.getRow(r)
    const dst = sheet.getRow(dstStart + r - 1)
    dst.height = src.height
    for (let c = 1; c <= colCount; c++) {
      const cell = src.getCell(c)
      const d = dst.getCell(c)
      d.value = cell.value
      if (cell.font) d.font = { ...cell.font }
      if (cell.fill) d.fill = { ...cell.fill }
      if (cell.border) d.border = { ...cell.border }
      if (cell.alignment) d.alignment = { ...cell.alignment }
      if (cell.numFmt) d.numFmt = cell.numFmt
    }
  }

  // Срез массива — mergeCells дописывает в model.merges, итерируемся по копии
  const merges = [...((sheet.model && sheet.model.merges) || [])]
  const offset = dstStart - 1
  for (const m of merges) {
    const parsed = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m)
    if (!parsed) continue
    sheet.mergeCells(
      `${parsed[1]}${Number(parsed[2]) + offset}:${parsed[3]}${Number(parsed[4]) + offset}`
    )
  }
}

/**
 * Лист с огромным номером контейнера по центру — для нумерации коробок/паллет.
 * Пример: «МИКС-1», «ПАЛЛЕТ-2».
 */
function addLabelSheet(workbook, text) {
  const sheet = workbook.addWorksheet('Номер')
  // Широкий диапазон: мёрженная ячейка обрезает текст по своим границам,
  // поэтому под огромный шрифт отводим 8 колонок, а не одну
  sheet.columns = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((key) => ({ key, width: 20 }))
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
  for (let r = 8; r <= 12; r++) sheet.getRow(r).height = 40
  sheet.mergeCells('A8:H12')
  const cell = sheet.getCell('A8')
  cell.value = text
  cell.font = { bold: true, size: 72 }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
}

/**
 * Экспорт товаров конкретного короба с пломбой
 * @param {Object} box - объект короба
 * @returns {Object} результат экспорта
 */
export async function exportBoxToExcel(box) {
  if (!box || !box.items || box.items.length === 0) {
    return { success: false, error: 'Короб пуст' }
  }

  try {
    // Создаём новую книгу Excel
    const workbook = new Excel.Workbook()

    // === Лист 1: Товары ===
    const itemsSheet = workbook.addWorksheet('Товары')

    // Заголовки таблицы
    itemsSheet.columns = [
      { header: 'Номер', key: 'number', width: 20 },
      { header: 'Наименование', key: 'name', width: 40 },
      { header: 'Код товара', key: 'article', width: 15 },
      { header: 'Комментарий', key: 'comment', width: 35 },
      { header: 'Дата сканирования', key: 'scannedAt', width: 22 }
    ]

    // Добавляем товары
    box.items.forEach((item) => {
      itemsSheet.addRow({
        number: item.number,
        name: item.name,
        article: item.article,
        comment: item.comment || '',
        scannedAt: item.scannedAt ? new Date(item.scannedAt).toLocaleString('ru-RU') : ''
      })
    })

    // Стиль заголовков
    const headerRow = itemsSheet.getRow(1)
    headerRow.font = { bold: true, size: 11 }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8F3FF' }
    }
    headerRow.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    // Стиль ячеек
    itemsSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      }
    })

    // === Лист 2: Пломба (по шаблону) ===
    const sealSheet = workbook.addWorksheet('Пломба')

    // Настройка колонок
    sealSheet.columns = [
      { key: 'a', width: 35 },
      { key: 'b', width: 35 }
    ]

    // Общие стили
    const blueColor = { argb: 'FF1989FA' } // Синий цвет
    const blackColor = { argb: 'FF000000' } // Чёрный цвет
    const grayColor = { argb: 'FF999999' } // Серый цвет

    // Строка 1: ПЛОМБА
    const titleCell = sealSheet.getCell('A1')
    titleCell.value = 'ПЛОМБА'
    titleCell.font = { bold: true, size: 20, color: blueColor }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A1:B1')
    sealSheet.getRow(1).height = 35
    // Границы
    sealSheet.getRow(1).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Строка 2: ОП № 187 г.Тамбов (статичный текст)
    const opCell = sealSheet.getCell('A2')
    opCell.value = 'ОП № 187 г.Тамбов'
    opCell.font = { bold: true, size: 16, color: blueColor }
    opCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A2:B2')
    sealSheet.getRow(2).height = 30
    // Границы
    sealSheet.getRow(2).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Строка 3: Микс-Короб №X
    const boxCell = sealSheet.getCell('A3')
    boxCell.value = `Микс-Короб №${box.number ?? box.box_number ?? '—'}`
    boxCell.font = { bold: true, size: 14, color: blackColor }
    boxCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A3:B3')
    sealSheet.getRow(3).height = 28
    // Границы
    sealSheet.getRow(3).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Строка 4: Количество товаров
    const qtyRow = sealSheet.getRow(4)
    qtyRow.getCell('A').value = 'Количество товаров:'
    qtyRow.getCell('A').font = { bold: true, size: 11 }
    qtyRow.getCell('A').alignment = { horizontal: 'left', vertical: 'middle' }
    qtyRow.getCell('B').value = `${box.items.length} шт.`
    qtyRow.getCell('B').font = { size: 11 }
    qtyRow.getCell('B').alignment = { horizontal: 'right', vertical: 'middle' }
    qtyRow.height = 25
    // Границы
    qtyRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Строка 5: Дата сборки
    const dateRow = sealSheet.getRow(5)
    dateRow.getCell('A').value = 'Дата сборки:'
    dateRow.getCell('A').font = { bold: true, size: 11 }
    dateRow.getCell('A').alignment = { horizontal: 'left', vertical: 'middle' }
    dateRow.getCell('B').value = new Date(
      box.createdAt || box.created_at || Date.now()
    ).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    dateRow.getCell('B').font = { size: 11 }
    dateRow.getCell('B').alignment = { horizontal: 'right', vertical: 'middle' }
    dateRow.height = 25
    // Границы
    dateRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Строка 6: Подпись
    const signRow = sealSheet.getRow(6)
    signRow.getCell('A').value = 'Подпись:'
    signRow.getCell('A').font = { bold: true, size: 11 }
    signRow.getCell('A').alignment = { horizontal: 'left', vertical: 'middle' }
    signRow.getCell('B').value = ''
    signRow.getCell('B').alignment = { horizontal: 'left', vertical: 'middle' }
    signRow.height = 30
    sealSheet.mergeCells('A6:B6')
    // Границы
    signRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Строка 7: М.П.
    const mpCell = sealSheet.getCell('A7')
    mpCell.value = 'М.П.'
    mpCell.font = { bold: true, size: 14, color: blackColor }
    mpCell.alignment = { horizontal: 'left', vertical: 'middle' }
    sealSheet.mergeCells('A7:B7')
    sealSheet.getRow(7).height = 30
    // Границы
    sealSheet.getRow(7).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Строка 8: Нижний текст
    const footerCell = sealSheet.getCell('A8')
    footerCell.value = 'Пломба наклеивается на короб для защиты содержимого'
    footerCell.font = { italic: true, size: 9, color: grayColor }
    footerCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A8:B8')
    sealSheet.getRow(8).height = 20
    // Границы
    sealSheet.getRow(8).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    // Генерируем имя файла
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const boxNumberLabel = box.number ?? box.box_number ?? 'без_номера'
    const fullName = `Микс_${boxNumberLabel}_${timestamp}.xlsx`

    // Вторая пломба на том же листе (опечатка с двух сторон) + лист с огромным номером
    duplicateSheetBlock(sealSheet, 8)
    addLabelSheet(workbook, `МИКС-${boxNumberLabel}`)

    // Скачиваем файл
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fullName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    return { success: true, filename: fullName }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Экспорт отдельных товаров в Excel
 * @param {Array} items - массив отдельных товаров
 * @returns {Promise<Object>} результат экспорта
 */
export async function exportSeparateToExcel(items) {
  if (!items || items.length === 0) {
    return { success: false, error: 'Список пуст' }
  }

  try {
    const workbook = new Excel.Workbook()
    const itemsSheet = workbook.addWorksheet('Товары')

    itemsSheet.columns = [
      { header: 'Место', key: 'placeNumber', width: 10 },
      { header: 'Номер', key: 'number', width: 20 },
      { header: 'Наименование', key: 'name', width: 40 },
      { header: 'Код товара', key: 'article', width: 15 },
      { header: 'Комментарий', key: 'comment', width: 35 },
      { header: 'Дата сканирования', key: 'scannedAt', width: 22 }
    ]

    items.forEach((item) => {
      const dateStr = item.scannedAt ? new Date(item.scannedAt).toLocaleString('ru-RU') : '' // E1 fix: null-check
      itemsSheet.addRow({
        placeNumber: String(item.placeNumber).padStart(3, '0'),
        number: item.number,
        name: item.name,
        article: item.article,
        comment: item.comment || '',
        scannedAt: dateStr
      })
    })

    const headerRow = itemsSheet.getRow(1)
    headerRow.font = { bold: true, size: 11 }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3FF' } }
    headerRow.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    itemsSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      }
    })

    const sealSheet = workbook.addWorksheet('Пломба')
    sealSheet.columns = [
      { key: 'a', width: 35 },
      { key: 'b', width: 35 }
    ]

    const blueColor = { argb: 'FF1989FA' }
    const blackColor = { argb: 'FF000000' }
    const grayColor = { argb: 'FF999999' }

    const titleCell = sealSheet.getCell('A1')
    titleCell.value = 'ПЛОМБА'
    titleCell.font = { bold: true, size: 20, color: blueColor }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A1:B1')
    sealSheet.getRow(1).height = 35

    const opCell = sealSheet.getCell('A2')
    opCell.value = 'ОП № 187 г.Тамбов'
    opCell.font = { bold: true, size: 16, color: blueColor }
    opCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A2:B2')
    sealSheet.getRow(2).height = 30

    const boxCell = sealSheet.getCell('A3')
    boxCell.value = 'Отдельные товары'
    boxCell.font = { bold: true, size: 14, color: blackColor }
    boxCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A3:B3')
    sealSheet.getRow(3).height = 28

    const qtyRow = sealSheet.getRow(4)
    qtyRow.getCell('A').value = 'Количество товаров:'
    qtyRow.getCell('A').font = { bold: true, size: 11 }
    qtyRow.getCell('B').value = `${items.length} шт.`
    qtyRow.height = 25

    const dateRow = sealSheet.getRow(5)
    dateRow.getCell('A').value = 'Дата сборки:'
    dateRow.getCell('A').font = { bold: true, size: 11 }
    dateRow.getCell('B').value = new Date().toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    dateRow.height = 25

    const signRow = sealSheet.getRow(6)
    signRow.getCell('A').value = 'Подпись:'
    signRow.getCell('A').font = { bold: true, size: 11 }
    signRow.getCell('B').value = ''
    signRow.height = 30
    sealSheet.mergeCells('A6:B6')

    const mpCell = sealSheet.getCell('A7')
    mpCell.value = 'М.П.'
    mpCell.font = { bold: true, size: 14, color: blackColor }
    sealSheet.mergeCells('A7:B7')
    sealSheet.getRow(7).height = 30

    const footerCell = sealSheet.getCell('A8')
    footerCell.value = 'Пломба наклеивается на короб для защиты содержимого'
    footerCell.font = { italic: true, size: 9, color: grayColor }
    footerCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A8:B8')
    sealSheet.getRow(8).height = 20

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const fullName = `Отдельные_${timestamp}.xlsx`

    // Вторая пломба на том же листе (опечатка с двух сторон) + лист с огромным номером
    duplicateSheetBlock(sealSheet, 8)
    addLabelSheet(workbook, 'ОТДЕЛЬНЫЕ')

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fullName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    return { success: true, filename: fullName }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Экспорт паллета в Excel с иерархией (короба + отдельные товары)
 */
export async function exportPalletToExcel(pallet) {
  if (!pallet) {
    return { success: false, error: 'Паллет не найден' }
  }

  try {
    // BUG-231 fix: передаём store как параметр вместо вызова вне setup
    const boxesStoreModule = await import('@/stores/boxes.js')
    const boxesStore = boxesStoreModule.useBoxesStore()

    // Читаем items из IndexedDB
    let palletItems = null
    const palletId = pallet.id || pallet.backendId || pallet.palletId
    if (palletId) {
      const itemsResult = await db.palletItems.getByPalletId(palletId)
      if (itemsResult?.data && itemsResult.data.length > 0) {
        palletItems = itemsResult.data
      }
    }

    // Если в хранилище нет записей — используем локальные товары pallet.items как fallback
    if (!palletItems || palletItems.length === 0) {
      palletItems = (pallet.items || []).map((i) => ({ ...i }))
    }

    // Заменяем комментарии для inline/pallet items из pallet.items если они есть
    if (pallet.items && pallet.items.length > 0) {
      for (const localItem of pallet.items) {
        if (localItem.source_type !== 'box') {
          const idx = palletItems.findIndex(
            (i) => i.source_type === localItem.source_type && i.source_id === localItem.source_id
          )
          if (idx !== -1) {
            // Обновляем comment из локальных данных
            palletItems[idx].item_comment = localItem.item_comment || localItem.comment || ''
            palletItems[idx].comment = localItem.item_comment || localItem.comment || ''
          }
        }
      }
    }

    // Deduplicate по (source_type, source_id) — оставляем запись с max order_num
    if (palletItems && palletItems.length > 0) {
      const seen = new Map()
      for (const item of palletItems) {
        const key = `${item.source_type}:${item.source_id}`
        if (!seen.has(key) || (item.order_num || 0) > (seen.get(key)?.order_num || -1)) {
          seen.set(key, item)
        }
      }
      palletItems = Array.from(seen.values())
    }

    if (!palletItems || palletItems.length === 0) {
      return { success: false, error: 'Паллет пуст' }
    }

    const workbook = new Excel.Workbook()

    // === Лист 1: Содержимое паллета (иерархия) ===
    const contentSheet = workbook.addWorksheet('Содержимое')

    contentSheet.columns = [
      { header: 'Тип', key: 'type', width: 15 },
      { header: 'Номер/Название', key: 'identifier', width: 30 },
      { header: 'Наименование', key: 'name', width: 40 },
      { header: 'Код товара', key: 'article', width: 15 },
      { header: 'Комментарий', key: 'comment', width: 35 },
      { header: 'Дата сканирования', key: 'scannedAt', width: 22 }
    ]

    for (const item of palletItems) {
      if (item.source_type === 'box') {
        // Берём номер микса из boxesStore по source_id — order_num может быть неверным
        const box = boxesStore.boxes?.find((b) => b.id === item.source_id)
        const boxNumber = box?.number || box?.box_number || item.order_num || ''
        contentSheet.addRow({
          type: '',
          identifier: `Микс #${boxNumber}`,
          name: '',
          article: '',
          comment: '—',
          scannedAt: ''
        })
        let boxItems = item.item_data?.items
        if (!boxItems || boxItems.length === 0) {
          boxItems = item._full_data?.items
        }
        if (!boxItems || boxItems.length === 0) {
          const box = boxesStore.boxes?.find((b) => b.id === item.source_id)
          if (box && box.items?.length > 0) {
            boxItems = box.items
          }
        }
        if (boxItems) {
          for (const boxItem of boxItems) {
            // normalize: scanned_at, data_scanned_at, scannedAt — любой найдётся
            const boxScannedAt =
              boxItem.scanned_at || boxItem.data_scanned_at || boxItem.scannedAt || ''
            contentSheet.addRow({
              type: '',
              identifier: boxItem.barcode || boxItem.number || '',
              name: boxItem.name || '',
              article: boxItem.brand || boxItem.article || '',
              comment: boxItem.comment || '',
              scannedAt: boxScannedAt ? new Date(boxScannedAt).toLocaleString('ru-RU') : ''
            })
          }
        }
      } else if (item.source_type === 'separate_item') {
        const data = item._full_data || {}
        // normalize: snake_case первыми (формат данных в IndexedDB), затем camelCase fallback
        const sepScannedAt =
          data.scanned_at || data.data_scanned_at || data.scannedAt || item.scannedAt || ''
        contentSheet.addRow({
          type: '📋 Паллет',
          identifier: data.number || item.item_barcode || '',
          name: data.name || item.item_name || '',
          article: data.article || item.item_brand || '',
          comment: data.comment || '',
          scannedAt: sepScannedAt ? new Date(sepScannedAt).toLocaleString('ru-RU') : ''
        })
      } else if (item.source_type === 'inline' || item.source_type === 'pallet') {
        // inline/pallet items паллета — данные из pallet_items напрямую
        const identifier = item.item_barcode || item.source_id || ''

        // Читаем поля напрямую из pallet_items — без _full_data обёртки
        const name =
          item.item_name && item.item_name.trim() ? item.item_name : `Товар ${identifier}`
        const article = item.item_brand || item.article || ''
        const comment = item.item_comment || item.comment || ''
        const scannedAtRaw = item.scanned_at || item.scannedAt || ''
        const scannedAt = scannedAtRaw ? new Date(scannedAtRaw).toLocaleString('ru-RU') : ''

        contentSheet.addRow({
          type: '📦 Паллет',
          identifier,
          name,
          article,
          comment,
          scannedAt
        })
      }
    }

    const headerRow = contentSheet.getRow(1)
    headerRow.font = { bold: true, size: 11 }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3FF' } }
    headerRow.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    contentSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1)
        row.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
    })

    // === Лист 2: Пломба ===
    const sealSheet = workbook.addWorksheet('Пломба')
    sealSheet.columns = [
      { key: 'a', width: 35 },
      { key: 'b', width: 35 }
    ]

    const blueColor = { argb: 'FF1989FA' }
    const blackColor = { argb: 'FF000000' }
    const grayColor = { argb: 'FF999999' }

    sealSheet.getCell('A1').value = 'ПЛОМБА'
    sealSheet.getCell('A1').font = { bold: true, size: 20, color: blueColor }
    sealSheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A1:B1')
    sealSheet.getRow(1).height = 35
    sealSheet.getCell('A2').value = 'ОП № 187 г.Тамбов'
    sealSheet.getCell('A2').font = { bold: true, size: 16, color: blueColor }
    sealSheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A2:B2')
    sealSheet.getRow(2).height = 30

    const palletCell = sealSheet.getCell('A3')
    palletCell.value = `Паллет №${pallet.number}`
    palletCell.font = { bold: true, size: 14, color: blackColor }
    palletCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A3:B3')
    sealSheet.getRow(3).height = 28

    let totalBoxes = 0,
      totalItems = 0
    // Используем deduplicated palletItems вместо raw pallet.items — защита от дубликатов
    const itemsList = palletItems || []
    itemsList.forEach((i) => {
      if (i.source_type === 'box') totalBoxes++
    })
    // Считаем separate_item + inline как отдельные товары
    totalItems = itemsList.filter(
      (i) => i.source_type === 'separate_item' || i.source_type === 'inline'
    ).length

    sealSheet.getRow(4).getCell('A').value = 'Коробов:'
    sealSheet.getRow(4).getCell('A').font = { bold: true, size: 11 }
    sealSheet.getRow(4).getCell('A').alignment = { horizontal: 'left', vertical: 'middle' }
    sealSheet.getRow(4).getCell('B').value = `${totalBoxes} шт.`
    sealSheet.getRow(4).getCell('B').font = { size: 11 }
    sealSheet.getRow(4).getCell('B').alignment = { horizontal: 'right', vertical: 'middle' }
    sealSheet.getRow(4).height = 25
    sealSheet.getRow(5).getCell('A').value = 'Товаров в паллете:'
    sealSheet.getRow(5).getCell('A').font = { bold: true, size: 11 }
    sealSheet.getRow(5).getCell('A').alignment = { horizontal: 'left', vertical: 'middle' }
    sealSheet.getRow(5).getCell('B').value = `${totalItems} шт.`
    sealSheet.getRow(5).getCell('B').font = { size: 11 }
    sealSheet.getRow(5).getCell('B').alignment = { horizontal: 'right', vertical: 'middle' }
    sealSheet.getRow(5).height = 25

    const dateRow = sealSheet.getRow(6)
    dateRow.getCell('A').value = 'Дата формирования:'
    dateRow.getCell('A').font = { bold: true, size: 11 }
    dateRow.getCell('A').alignment = { horizontal: 'left', vertical: 'middle' }
    const dateVal = pallet.createdAt || pallet.created_at || new Date()
    dateRow.getCell('B').value = new Date(dateVal).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    dateRow.getCell('B').font = { size: 11 }
    dateRow.getCell('B').alignment = { horizontal: 'right', vertical: 'middle' }
    dateRow.height = 25

    sealSheet.getRow(7).getCell('A').value = 'Подпись:'
    sealSheet.getRow(7).getCell('A').font = { bold: true, size: 11 }
    sealSheet.getRow(7).getCell('A').alignment = { horizontal: 'left', vertical: 'middle' }
    sealSheet.getRow(7).getCell('B').value = ''
    sealSheet.getRow(7).height = 30

    sealSheet.getRow(4).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })
    sealSheet.getRow(5).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })
    dateRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })
    sealSheet.getRow(7).eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    sealSheet.getCell('A8').value = 'М.П.'
    sealSheet.getCell('A8').font = { bold: true, size: 14, color: blackColor }
    sealSheet.mergeCells('A8:B8')
    const footerCell = sealSheet.getCell('A9')
    footerCell.value = 'Пломба наклеивается на паллет для защиты содержимого'
    footerCell.font = { italic: true, size: 9, color: grayColor }
    footerCell.alignment = { horizontal: 'center', vertical: 'middle' }
    sealSheet.mergeCells('A9:B9')

    for (let i = 1; i <= 9; i++)
      sealSheet.getRow(i).eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      })

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const fullName = `Паллет_${pallet.number}_${timestamp}.xlsx`

    // Вторая пломба на том же листе (опечатка с двух сторон) + лист с огромным номером
    duplicateSheetBlock(sealSheet, 9)
    addLabelSheet(workbook, `ПАЛЛЕТ-${pallet.number}`)

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fullName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    return { success: true, filename: fullName }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Экспорт всех паллетов в Excel
 * @param {Array} palletItems - массив всех items из всех паллетов
 * @param {string} filename - имя файла
 * @returns {Object} результат экспорта
 */
export async function exportPalletsToExcel(palletItems, filename = 'Все_паллеты') {
  if (!palletItems || palletItems.length === 0) {
    return { success: false, error: 'Нет данных для экспорта' }
  }

  try {
    const workbook = new Excel.Workbook()
    const sheet = workbook.addWorksheet('Паллеты')

    // Заголовки
    sheet.columns = [
      { header: 'Паллет', key: 'pallet', width: 20 },
      { header: 'Тип', key: 'type', width: 12 },
      { header: 'Номер', key: 'number', width: 20 },
      { header: 'Наименование', key: 'name', width: 40 },
      { header: 'Код товара', key: 'article', width: 15 },
      { header: 'Дата сканирования', key: 'scannedAt', width: 22 }
    ]

    // Данные
    palletItems.forEach((item) => {
      sheet.addRow({
        pallet: item.palletName,
        type: item.type,
        number: item.number,
        name: item.name,
        article: item.article || '',
        scannedAt: item.scannedAt ? new Date(item.scannedAt).toLocaleString('ru-RU') : ''
      })
    })

    // Стиль заголовков — зелёный
    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF217346' }
    }
    headerRow.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }

    // Стиль ячеек
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      }
    })

    // Экспорт
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    return { success: true, filename: link.download }
  } catch (error) {
    return { success: false, error: error.message }
  }
}
