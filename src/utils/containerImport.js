import * as XLSX from 'xlsx'
import { dbStore as db } from '@/lib/db.js'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'

/**
 * Импорт готовых контейнеров из Excel-выгрузок этого же приложения
 * (файлы «Микс_*», «Отдельные_*», «Паллет_*» из utils/excel.js).
 *
 * Формат определяется по листам и ячейке A3 листа «Пломба»:
 * - «Содержимое» + «Паллет №N» → паллет
 * - «Товары» + «Микс-Короб №N» → микс
 * - «Товары» + «Отдельные товары» → отдельные товары
 *
 * Правила (согласованы с пользователем):
 * - товары, которых нет в базе брака, всё равно импортируются,
 *   но попадают в отчёт (report.unknown);
 * - дубли (внутри файла и с уже хранящимися данными) пропускаются с отчётом;
 * - импортированные миксы/паллеты сразу помечаются finished — это готовые данные;
 * - счётчики номеров подтягиваются выше импортированных, чтобы не было коллизий.
 */

export const IMPORT_TYPES = { MIX: 'mix', SEPARATE: 'separate', PALLET: 'pallet' }

const str = (v) => String(v ?? '').trim()

/* ============================================================
   Чтение и распознавание файла
   ============================================================ */

export async function readContainerWorkbook(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheets = {}
  for (const name of workbook.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' })
  }
  return { sheetNames: workbook.SheetNames, sheets, workbook }
}

// Значение A3 листа «Пломба» (там merged A3:B3 — значение лежит в A3)
function readSealTitle(workbook) {
  const ws = workbook.Sheets['Пломба']
  if (!ws) return ''
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  return str(grid?.[2]?.[0])
}

export function detectContainerType(parsed) {
  const seal = readSealTitle(parsed.workbook)
  if (parsed.sheetNames.includes('Содержимое')) {
    const m = seal.match(/Паллет\s*№\s*(\d+)/i)
    return { type: IMPORT_TYPES.PALLET, number: m ? Number(m[1]) : null, seal }
  }
  if (parsed.sheetNames.includes('Товары')) {
    const m = seal.match(/Микс-Короб\s*№\s*(\d+)/i)
    if (m) return { type: IMPORT_TYPES.MIX, number: Number(m[1]), seal }
    if (/Отдельные товары/i.test(seal)) return { type: IMPORT_TYPES.SEPARATE, number: null, seal }
  }
  return { type: null, number: null, seal }
}

/* ============================================================
   Парсинг листов (колонки — как в utils/excel.js)
   ============================================================ */

function parseItemRow(r) {
  return {
    raw: str(r['Номер'] || r['Номер/Название']),
    name: str(r['Наименование']) || 'Без названия',
    article: str(r['Код товара']),
    comment: str(r['Комментарий'])
  }
}

export function parseMixSheet(rows) {
  return (rows || []).map(parseItemRow).filter((r) => r.raw !== '')
}

export function parseSeparateSheet(rows) {
  return (rows || []).map(parseItemRow).filter((r) => r.raw !== '')
}

export function parsePalletSheet(rows) {
  const mixes = []
  const separateItems = []
  const inlineItems = []
  const orphans = []
  let current = null
  for (const r of rows || []) {
    const type = str(r['Тип'])
    const id = str(r['Номер/Название'])
    const name = str(r['Наименование'])
    if (!id && !name) continue
    const mixHead = id.match(/^Микс\s*#\s*(\d+)/i)
    if (mixHead) {
      current = { number: Number(mixHead[1]), items: [] }
      mixes.push(current)
      continue
    }
    if (type.includes('📋')) {
      separateItems.push({ ...parseItemRow(r), raw: id })
      current = null
      continue
    }
    if (type.includes('📦')) {
      inlineItems.push({ ...parseItemRow(r), raw: id })
      current = null
      continue
    }
    // Обычная строка товара — относится к текущему миксу
    if (current && id) {
      current.items.push(parseItemRow(r))
    } else if (id) {
      orphans.push(parseItemRow(r))
    }
  }
  return { mixes, separateItems, inlineItems, orphans }
}

/* ============================================================
   Отчёт и нормализация
   ============================================================ */

export function createImportReport(fileName, type) {
  return {
    fileName,
    type,
    created: [], // { kind: 'box'|'pallet'|'separate', number, name, items }
    reused: [], // существующие контейнеры, в которые дозаполнили данные
    remapped: [], // { kind, from, to } — номер из файла был занят
    skippedDuplicates: [], // { barcode, name, where }
    unknown: [], // { barcode, name } — нет в базе брака, но импортированы
    errors: [] // строки
  }
}

// Номер из файла → нормализованный вид базы («187/45328»). null = мусор.
export function normalizeImportNumber(raw) {
  const s = str(raw)
  if (!s) return null
  return parseBarcodeToBrainNumber(s)
}

// Где уже лежит штрихкод: микс (включая завершённые) или inline-товар паллеты.
// Возвращает null если нигде нет.
async function findBarcodeUsage(barcode, excludePalletId = null) {
  try {
    const found = await db.boxItems.findByBarcode(barcode)
    if (found?.data?.box_number != null) {
      return { kind: 'box', number: found.data.box_number, name: found.data.box_name }
    }
  } catch {
    // ignore — считаем что не найден
  }
  try {
    const found = await db.palletItems.findInlineByBarcode(barcode, excludePalletId)
    if (found?.data?.pallet_number != null) {
      return { kind: 'pallet', number: found.data.pallet_number, name: found.data.pallet_name }
    }
  } catch {
    // ignore
  }
  return null
}

function usageLabel(usage) {
  if (!usage) return 'неизвестно где'
  if (usage.kind === 'box') return `Микс №${usage.number}`
  return `Паллет №${usage.number}`
}

/* ============================================================
   Базовые операции
   ============================================================ */

// Найти короб по номеру или создать новый. Номер из файла сохраняется,
// если свободен, иначе короб остаётся на выданном счётчиком номере (remap в отчёт).
async function ensureImportBox(boxNumber, report) {
  const all = (await db.boxes.getAll()).data || []
  const existing = all.find((b) => Number(b.box_number) === Number(boxNumber))
  if (existing) return { id: existing.id, number: existing.box_number, reused: true }

  const created = await db.boxes.create()
  if (created.error) throw new Error(created.error.message || 'Не удалось создать короб')
  let finalNumber = created.data.box_number
  const taken = new Set(all.map((b) => Number(b.box_number)))
  if (boxNumber != null && !taken.has(Number(boxNumber))) {
    await db.boxes.update(created.data.id, {
      box_number: boxNumber,
      name: `Короб №${boxNumber}`
    })
    finalNumber = boxNumber
    await db.settings.ensureCounterAtLeast('box_counter', Number(boxNumber) + 1)
  } else if (boxNumber != null) {
    report.remapped.push({ kind: 'box', from: boxNumber, to: finalNumber })
  }
  return { id: created.data.id, number: finalNumber, reused: false }
}

// Добавить строки товаров в короб с проверками. Возвращает число добавленных.
async function addRowsToBox(boxId, rows, brainSet, report, excludePalletId = null) {
  const seen = new Set()
  let added = 0
  for (const row of rows) {
    const barcode = normalizeImportNumber(row.raw)
    if (!barcode) {
      report.errors.push(`«${row.raw}»: не распознан номер — строка пропущена`)
      continue
    }
    if (seen.has(barcode)) {
      report.skippedDuplicates.push({ barcode, name: row.name, where: 'этот же файл' })
      continue
    }
    seen.add(barcode)
    if (!brainSet.has(barcode)) report.unknown.push({ barcode, name: row.name })
    const usage = await findBarcodeUsage(barcode, excludePalletId)
    if (usage) {
      report.skippedDuplicates.push({ barcode, name: row.name, where: usageLabel(usage) })
      continue
    }
    try {
      const res = await db.boxItems.addItem(boxId, {
        barcode,
        name: row.name,
        brand: row.article || '',
        comment: row.comment || ''
      })
      if (res.error) {
        report.skippedDuplicates.push({ barcode, name: row.name, where: 'другой контейнер' })
        continue
      }
      added++
    } catch (e) {
      if (e?.name === 'ConstraintError') {
        report.skippedDuplicates.push({ barcode, name: row.name, where: 'другой контейнер' })
      } else {
        report.errors.push(`«${barcode}»: ${e?.message || 'не удалось сохранить'}`)
      }
    }
  }
  return added
}

async function finishBox(boxId) {
  await db.boxes.update(boxId, { status: 'finished' })
}

/* ============================================================
   Импорт микса
   ============================================================ */

export async function importMix(rows, fileNumber, brainSet, report) {
  const box = await ensureImportBox(fileNumber, report)
  const added = await addRowsToBox(box.id, rows, brainSet, report)
  // Готовый микс из файла — завершаем только свежесозданный короб,
  // существующий (возможно, собираемый сейчас) не трогаем.
  if (!box.reused) await finishBox(box.id)
  const entry = { kind: 'box', number: box.number, name: `Микс №${box.number}`, items: added }
  if (box.reused) report.reused.push(entry)
  else report.created.push(entry)
  return box
}

/* ============================================================
   Импорт отдельных товаров
   ============================================================ */

export async function importSeparate(rows, brainSet, report) {
  const existingBarcodes = new Set()
  try {
    const all = (await db.separateItems.getAll()).data || []
    for (const i of all) {
      if (i.barcode) existingBarcodes.add(i.barcode)
      const p = parseBarcodeToBrainNumber(i.barcode)
      if (p) existingBarcodes.add(p)
    }
  } catch {
    // ignore — дальше отработают проверки на каждый товар
  }
  const seen = new Set()
  let added = 0
  for (const row of rows) {
    const barcode = normalizeImportNumber(row.raw)
    if (!barcode) {
      report.errors.push(`«${row.raw}»: не распознан номер — строка пропущена`)
      continue
    }
    if (seen.has(barcode) || existingBarcodes.has(barcode)) {
      report.skippedDuplicates.push({ barcode, name: row.name, where: 'список «Отдельные»' })
      continue
    }
    seen.add(barcode)
    if (!brainSet.has(barcode)) report.unknown.push({ barcode, name: row.name })
    const usage = await findBarcodeUsage(barcode)
    if (usage) {
      report.skippedDuplicates.push({ barcode, name: row.name, where: usageLabel(usage) })
      continue
    }
    try {
      const res = await db.separateItems.add({
        barcode,
        name: row.name,
        brand: row.article || '',
        comment: row.comment || ''
      })
      if (res.error) throw new Error(res.error.message)
      existingBarcodes.add(barcode)
      added++
    } catch (e) {
      if (e?.name === 'ConstraintError' || /duplicate|unique|constraint/i.test(e?.message || '')) {
        report.skippedDuplicates.push({ barcode, name: row.name, where: 'список «Отдельные»' })
      } else {
        report.errors.push(`«${barcode}»: ${e?.message || 'не удалось сохранить'}`)
      }
    }
  }
  report.created.push({ kind: 'separate', number: null, name: 'Отдельные товары', items: added })
  return added
}

/* ============================================================
   Импорт паллеты
   ============================================================ */

export async function importPallet(parsed, fileNumber, brainSet, report) {
  for (const orphan of parsed.orphans) {
    report.errors.push(`«${orphan.raw}»: строка вне микса — пропущена`)
  }

  // Создаём паллету (номер из файла — если свободен)
  const allPallets = (await db.pallets.getAll()).data || []
  const palletTaken = new Set(allPallets.map((p) => Number(p.pallet_number)))
  const created = await db.pallets.create()
  if (created.error) throw new Error(created.error.message || 'Не удалось создать паллет')
  const palletId = created.data.id
  let palletNumber = created.data.pallet_number
  if (fileNumber != null && !palletTaken.has(Number(fileNumber))) {
    await db.pallets.update(palletId, {
      pallet_number: fileNumber,
      name: `Паллет №${fileNumber}`
    })
    palletNumber = fileNumber
    await db.settings.ensureCounterAtLeast('pallet_counter', Number(fileNumber) + 1)
  } else if (fileNumber != null) {
    report.remapped.push({ kind: 'pallet', from: fileNumber, to: palletNumber })
  }

  let attached = 0

  // Миксы: находим существующие или восстанавливаем по строкам файла
  for (const mix of parsed.mixes) {
    const box = await ensureImportBox(mix.number, report)
    // Микс уже упакован в другую паллету — повторно класть нельзя
    try {
      const usage = await db.palletItems.findBoxUsage(box.id, palletId)
      if (usage?.data?.pallet_number != null) {
        report.skippedDuplicates.push({
          barcode: `Микс №${box.number}`,
          name: '',
          where: `Паллет №${usage.data.pallet_number}`
        })
        continue
      }
    } catch {
      // ignore
    }
    if (!box.reused) {
      await addRowsToBox(box.id, mix.items, brainSet, report, palletId)
      await finishBox(box.id)
      report.created.push({
        kind: 'box',
        number: box.number,
        name: `Микс №${box.number}`,
        items: mix.items.length
      })
    }
    try {
      const res = await db.palletItems.create(palletId, 'box', box.id)
      if (!res.error) attached++
    } catch {
      report.errors.push(`Микс №${box.number}: не удалось прикрепить к паллете`)
    }
  }

  // Отдельные товары (📋): ищем в списке или создаём и линкуем
  let separateCache = null
  const getSeparateCache = async () => {
    if (!separateCache) {
      separateCache = ((await db.separateItems.getAll()).data || []).map((i) => ({
        id: i.id,
        barcode: i.barcode
      }))
    }
    return separateCache
  }
  const seenSeparate = new Set()
  for (const row of parsed.separateItems) {
    const barcode = normalizeImportNumber(row.raw)
    if (!barcode || seenSeparate.has(barcode)) {
      if (barcode) {
        report.skippedDuplicates.push({ barcode, name: row.name, where: 'этот же файл' })
      } else {
        report.errors.push(`«${row.raw}»: не распознан номер — строка пропущена`)
      }
      continue
    }
    seenSeparate.add(barcode)
    if (!brainSet.has(barcode)) report.unknown.push({ barcode, name: row.name })
    const cache = await getSeparateCache()
    let entry = cache.find((i) => {
      if (i.barcode === barcode) return true
      return parseBarcodeToBrainNumber(i.barcode) === barcode
    })
    if (!entry) {
      const usage = await findBarcodeUsage(barcode, palletId)
      if (usage) {
        report.skippedDuplicates.push({ barcode, name: row.name, where: usageLabel(usage) })
        continue
      }
      try {
        const res = await db.separateItems.add({
          barcode,
          name: row.name,
          brand: row.article || '',
          comment: row.comment || ''
        })
        if (res.error) throw new Error(res.error.message)
        entry = { id: res.data.id, barcode }
        cache.push(entry)
      } catch (e) {
        report.errors.push(`«${barcode}»: ${e?.message || 'не удалось сохранить'}`)
        continue
      }
    }
    try {
      const res = await db.palletItems.create(palletId, 'separate_item', entry.id)
      if (!res.error) attached++
    } catch {
      report.errors.push(`«${barcode}»: не удалось прикрепить к паллете`)
    }
  }

  // Inline-товары паллеты (📦)
  const seenInline = new Set()
  for (const row of parsed.inlineItems) {
    const barcode = normalizeImportNumber(row.raw)
    if (!barcode || seenInline.has(barcode)) {
      if (barcode) {
        report.skippedDuplicates.push({ barcode, name: row.name, where: 'этот же файл' })
      } else {
        report.errors.push(`«${row.raw}»: не распознан номер — строка пропущена`)
      }
      continue
    }
    seenInline.add(barcode)
    if (!brainSet.has(barcode)) report.unknown.push({ barcode, name: row.name })
    const usage = await findBarcodeUsage(barcode, palletId)
    if (usage) {
      report.skippedDuplicates.push({ barcode, name: row.name, where: usageLabel(usage) })
      continue
    }
    try {
      await db.palletItems.addInline(palletId, {
        number: barcode,
        name: row.name,
        article: row.article || '',
        comment: row.comment || ''
      })
      attached++
    } catch (e) {
      report.errors.push(`«${barcode}»: ${e?.message || 'не удалось сохранить'}`)
    }
  }

  await db.pallets.update(palletId, { status: 'finished' })
  report.created.push({
    kind: 'pallet',
    number: palletNumber,
    name: `Паллет №${palletNumber}`,
    items: attached
  })
  return palletNumber
}
