import Dexie from 'dexie'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'

export const DB_NAME = 'warehouse-brain'

const db = new Dexie(DB_NAME)
db.version(1).stores({
  brain_items: '&barcode',
  boxes: '&status, &collector_id, id, box_number',
  box_items: '[boxId+barcode], &barcode',
  separate_items: 'id, &barcode',
  scan_history: 'id, barcode, created_at',
  pallets: '&status, &collector_id, id, pallet_number',
  pallet_items: '[palletId+source_type+source_id], &palletId',
  settings: '&key'
})

// BUG-fix v2: в v1 у таблицы boxes индексы status и collector_id были уникальными (&),
// поэтому второй короб со статусом 'active' (или тем же collector_id) падал с ConstraintError.
// По бизнес-логике активных коробов может быть много — уникальность не нужна.
// BUG-fix v3: в v1/v2 первым токеном (primary key) был status, а не id.
// Поэтому в таблице мог существовать только один 'active' и один 'finished' —
// завершение второго и следующих коробов падало с ConstraintError на add().
// Правильный primary key — id (UUID строки). Статус — обычный неуникальный индекс.
// То же самое для pallets. У pallet_items вторичный индекс &palletId был уникальным —
// второй бокс в паллете падал; делаем его неуникальным.
// ВАЖНО: Dexie не умеет менять primary key через upgrade ("Not yet support for changing
// primary key"), поэтому v3 для старых баз применяется через ensureDbReady():
// экспорт данных → удаление БД → создание с нуля по схеме v3 → импорт. См. ниже.
// Single-user: сборщик один, привязка коробов/паллет к employeeId (collector_id) удалена.
// v4 убирает индекс collector_id из boxes/pallets (обычный upgrade, без смены primary key).
db.version(2).stores({
  boxes: 'status, collector_id, id, box_number'
})
db.version(3).stores({
  boxes: 'id, status, collector_id, box_number',
  pallets: 'id, status, collector_id, pallet_number',
  pallet_items: '[palletId+source_type+source_id], palletId'
})
db.version(4).stores({
  boxes: 'id, status, box_number',
  pallets: 'id, status, pallet_number'
})

const MIGRATION_TABLES = [
  'brain_items',
  'boxes',
  'box_items',
  'separate_items',
  'scan_history',
  'pallets',
  'pallet_items',
  'settings'
]

// Читает данные из старой базы (схема v1/v2, primary key status) отдельным инстансом,
// который НЕ знает про v3 — иначе Dexie бросит UpgradeError и экспорт будет невозможен.
async function exportLegacyData() {
  const legacy = new Dexie(DB_NAME)
  legacy.version(1).stores({
    brain_items: '&barcode',
    boxes: '&status, &collector_id, id, box_number',
    box_items: '[boxId+barcode], &barcode',
    separate_items: 'id, &barcode',
    scan_history: 'id, barcode, created_at',
    pallets: '&status, &collector_id, id, pallet_number',
    pallet_items: '[palletId+source_type+source_id], &palletId',
    settings: '&key'
  })
  legacy.version(2).stores({
    boxes: 'status, collector_id, id, box_number'
  })
  try {
    await legacy.open()
    const backup = {}
    for (const name of MIGRATION_TABLES) {
      try {
        backup[name] = await legacy.table(name).toArray()
      } catch {
        backup[name] = []
      }
    }
    return backup
  } finally {
    legacy.close()
  }
}

function dedupeById(rows) {
  const map = new Map()
  for (const row of rows) {
    if (row && row.id !== undefined && row.id !== null) map.set(row.id, row)
  }
  return [...map.values()]
}

// Возвращает данные в базу с новой схемой. Старый костыль delete+add писал в строки
// поле key — чистим его, в схеме v3 его нет.
async function importBackupData(backup) {
  const boxes = dedupeById(backup.boxes || []).map((row) => {
    const clean = { ...row }
    delete clean.key
    delete clean.collector_id
    return clean
  })
  const pallets = dedupeById(backup.pallets || []).map((row) => {
    const clean = { ...row }
    delete clean.collector_id
    return clean
  })
  await db.table('brain_items').bulkPut(backup.brain_items || [])
  await db.table('boxes').bulkPut(boxes)
  await db.table('box_items').bulkPut(backup.box_items || [])
  await db.table('separate_items').bulkPut(backup.separate_items || [])
  await db.table('scan_history').bulkPut(backup.scan_history || [])
  await db.table('pallets').bulkPut(pallets)
  await db.table('pallet_items').bulkPut(backup.pallet_items || [])
  await db.table('settings').bulkPut(backup.settings || [])
}

// Открывает базу, при необходимости мигрируя со схемы v1/v2 (primary key status)
// на актуальную схему (primary key id). Вызывать один раз на старте приложения ДО любых
// чтений/записей — иначе первая операция сама спровоцирует UpgradeError.
// Ничего не удаляет, пока экспорт старых данных не завершился успешно.
export async function ensureDbReady() {
  try {
    await db.open()
  } catch (e) {
    const msg = String((e && e.message) || '')
    const isPkChange =
      (e && (e.name === 'UpgradeError' || e.name === 'SchemaError')) || /primary key/i.test(msg)
    if (!isPkChange) throw e
    console.warn('[db] legacy schema detected, migrating to v4…')
    const backup = await exportLegacyData()
    try {
      db.close()
    } catch {
      // Уже закрыта после неудачного upgrade — игнорируем
    }
    await Dexie.delete(DB_NAME)
    await db.open()
    await importBackupData(backup)
    console.warn('[db] migration to v4 done')
  }
  if (db.boxes.schema.primKey.keyPath !== 'id') {
    throw new Error(`[db] unexpected boxes primary key: ${db.boxes.schema.primKey.keyPath}`)
  }
}

function ok(data) {
  return { data, error: null }
}
function err(message) {
  return { data: null, error: { message } }
}
const nowIso = () => new Date().toISOString()

// Гвард создания миксов/паллет: без загруженной справочной БД (brain_items)
// создавать нечего — сканированные товары не с чем сверять.
// Возвращает объект ошибки в формате err() или null, если БД на месте.
// Вызывать ДО nextCounter, чтобы заблокированное создание не расходовало номер.
async function requireBrainDatabase() {
  const count = await db.brain_items.count()
  if (count === 0) return err('База данных не загружена. Загрузите Excel файл на главной странице')
  return null
}

// Генерация уникального ID: crypto.randomUUID недоступен в небезопасных контекстах
// (HTTP по LAN-IP, например http://192.168.2.98:5173). Фолбэк — HEX-UUID на Math.random.
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Монотонный счётчик номеров (короба/паллеты) в таблице settings.
// Номер выдаётся строго growing и никогда не переиспользуется при частичных
// очистках («Очистить всё» на экранах). Полный сброс данных (resetLocalData)
// удаляет счётчики, и нумерация начинается заново с 1. При первом вызове
// инициализируется как max(существующие)+1, поэтому корректно подхватывает
// и старые базы, и данные после ensureDbReady-импорта.
async function nextCounter(key, table, numberField) {
  const stored = await db.settings.get(key)
  let next = stored?.value
  if (typeof next !== 'number' || !Number.isFinite(next) || next < 1) {
    const all = await table.toArray()
    const max = all.reduce((m, r) => Math.max(m, Number(r[numberField]) || 0), 0)
    next = max + 1
  }
  await db.settings.put({ key, value: next + 1 })
  return next
}

export const dbStore = {
  // Полная очистка локальных данных (кэш/очереди IndexedDB).
  // Счётчики номеров коробов/паллет сбрасываются: после полного сброса
  // нумерация начинается заново с 1.
  async resetLocalData() {
    await Promise.all([
      db.brain_items.clear(),
      db.boxes.clear(),
      db.box_items.clear(),
      db.separate_items.clear(),
      db.scan_history.clear(),
      db.pallets.clear(),
      db.pallet_items.clear(),
      db.settings.bulkDelete(['box_counter', 'pallet_counter'])
    ])
    return ok(null, null)
  },
  brainItems: {
    async getAll() {
      const rows = await db.brain_items.toArray()
      return ok(
        rows.map((r) => ({ barcode: r.barcode, name: r.name, brand: r.brand, comment: r.comment }))
      )
    },
    async import({ rows }) {
      let count = 0
      for (const row of rows) {
        const existing = await db.brain_items.get(row.barcode)
        if (existing) {
          await db.brain_items.put({ ...existing, ...row, barcode: row.barcode })
        } else {
          await db.brain_items.add({ ...row, barcode: row.barcode })
        }
        count++
      }
      return ok({ count }, null)
    },
    async clearAll() {
      await db.brain_items.clear()
      return ok(null, null)
    }
  },

  boxes: {
    async getAll() {
      return ok(await db.boxes.toArray())
    },
    async getById(boxId) {
      const row = await db.boxes.get(boxId)
      if (!row) return err('Not found')
      return ok(row, null)
    },
    async create() {
      // Без справочной БД микс создавать нельзя.
      const noDb = await requireBrainDatabase()
      if (noDb) return noDb
      // Монотонный счётчик: номера коробов не повторяются при частичных
      // очистках. Ленивая инициализация от max(box_number).
      const box_number = await nextCounter('box_counter', db.boxes, 'box_number')
      try {
        const row = {
          id: generateId(),
          status: 'active',
          box_number,
          name: `Короб №${box_number}`,
          created_at: nowIso()
        }
        await db.boxes.add(row)
        return ok({ id: row.id, box_number, name: row.name }, null)
      } catch (e) {
        console.error('[db.boxes.create] FAILED', {
          box_number,
          error: e && e.message
        })
        throw e
      }
    },
    async update(boxId, payload = {}) {
      try {
        const all = await db.boxes.toArray()
        const existing = all.find((r) => r.id === boxId) || null
        if (!existing) return err('Not found')
        if (payload.item && typeof payload.item === 'object' && payload.item.barcode) {
          try {
            const dup = await db.box_items.where({ boxId, barcode: payload.item.barcode }).first()
            if (dup) return err('duplicate')
            await db.box_items.add({ ...payload.item, boxId, created_at: nowIso() })
          } catch (e2) {
            // Глобальный уникальный индекс &barcode в box_items не позволяет одному и тому же
            // barcode оказаться в разных коробках. checkGlobalDuplicate ловит дубли по локальным
            // активным миксам, но может пропустить завершённую коробку или несинхронизированный микс —
            // тогда добавление долетает до индекса и бросает ConstraintError. Превращем её в типизированную
            // ошибку (с номером коробки), чтобы addItemToCurrentBox сделал корректный откат и показал
            // «Товар уже в миксе» вместо необработанного исключения.
            if (e2 && e2.name === 'ConstraintError') {
              let boxNumber = 'неизвестен'
              try {
                const existingItem = await db.box_items
                  .where('barcode')
                  .equals(payload.item.barcode)
                  .first()
                if (existingItem) {
                  const box = await db.boxes.get(existingItem.boxId)
                  if (box) boxNumber = String(box.box_number ?? box.number ?? 'неизвестен')
                }
              } catch {
                // Если коробка уже удалена или её нет — оставляем 'неизвестен'
              }
              return {
                data: null,
                error: { message: 'duplicate_global', code: 409, box_number: boxNumber }
              }
            }
            throw e2
          }
          return ok(existing, null)
        }
        // v3: primary key таблицы — id, поэтому обновление делаем через put() по ключу.
        // Старый костыль delete+add с ручным key больше не нужен (он был для битого primary status).
        const updated = { ...existing, ...payload, updated_at: nowIso() }
        await db.boxes.put(updated)
        return ok(updated, null)
      } catch (e) {
        console.error('[db.boxes.update] FAILED', boxId, e)
        throw e
      }
    },
    async delete(boxId) {
      await db.box_items.where({ boxId }).delete()
      await db.boxes.delete(boxId)
      return ok(null, null)
    },
    async clearAllFinished({ active } = {}) {
      const boxes = await db.boxes.toArray()
      for (const b of boxes) {
        if ((active && b.status === 'active') || (!active && b.status !== 'active')) {
          await db.box_items.where({ boxId: b.id }).delete()
          await db.boxes.delete(b.id)
        }
      }
      return ok(null, null)
    }
  },

  boxItems: {
    async getByBoxId(boxId) {
      const rows = await db.box_items.where('boxId').equals(boxId).toArray()
      return ok(
        rows.map((r) => ({
          barcode: r.barcode,
          name: r.name,
          brand: r.brand,
          comment: r.comment,
          created_at: r.created_at
        }))
      )
    },
    // Поиск товара по штрихкоду во ВСЕХ миксах, включая завершённые и незагруженные
    // в память стора. БД — источник истины для проверки дубликатов со стороны паллеты:
    // in-memory checkGlobalDuplicate видит только активные контейнеры, поэтому товар
    // из завершённого микса проходил как новый (дубль).
    async findByBarcode(barcodes) {
      const list = (Array.isArray(barcodes) ? barcodes : [barcodes]).filter(Boolean)
      if (list.length === 0) return ok(null)
      let row = null
      try {
        row = await db.box_items.where('barcode').equalsAny(list).first()
      } catch {
        row = null
      }
      if (!row) {
        // Фолбэк для старых записей в ненормализованном виде (сырой Z-код):
        // сверяем через парсинг, как in-memory проверки в сторах.
        const targets = new Set(list)
        for (const b of list) {
          const p = parseBarcodeToBrainNumber(b)
          if (p) targets.add(p)
        }
        row =
          (await db.box_items
            .filter((r) => {
              if (!r || !r.barcode) return false
              if (targets.has(r.barcode)) return true
              const p = parseBarcodeToBrainNumber(r.barcode)
              return !!p && targets.has(p)
            })
            .first()) || null
      }
      if (!row) return ok(null)
      const box = await db.boxes.get(row.boxId).catch(() => null)
      return ok({
        boxId: row.boxId,
        box_number: box?.box_number ?? box?.number ?? null,
        box_name: box?.name ?? null
      })
    },
    async addItem(boxId, itemData) {
      const dup = await db.box_items.where({ boxId, barcode: itemData.barcode }).first()
      if (dup) return err('duplicate')
      const row = { ...itemData, boxId, created_at: nowIso() }
      const key = await db.box_items.add(row)
      return ok({ id: key, ...row }, null)
    },
    // Все строки для карты «штрихкод → микс» (колонка места в таблице брака)
    async getAll() {
      return ok(await db.box_items.toArray())
    },
    async deleteItem(boxId, barcode) {
      await db.box_items.where({ boxId, barcode }).delete()
      return ok(null, null)
    }
  },

  separateItems: {
    async getAll() {
      const rows = await db.separate_items.toArray()
      return ok(
        rows.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          name: r.brain_name || r.name,
          brand: r.brain_brand || r.brand,
          comment: r.comment,
          is_stop_item: r.is_stop_item,
          created_at: r.created_at
        }))
      )
    },
    async add(item) {
      const row = {
        // id обязателен: в схеме separate_items он ручной primary key (без ++),
        // без него Dexie кидает на каждой вставке — добавление молча не работало.
        id: generateId(),
        barcode: item.barcode,
        name: item.name,
        brand: item.brand,
        comment: item.comment,
        is_stop_item: item.is_stop_item,
        created_at: nowIso()
      }
      const key = await db.separate_items.add(row)
      return ok({ id: key }, null)
    },
    async getById(id) {
      const row = await db.separate_items.get(id)
      if (!row) return err('Not found')
      return ok(row, null)
    },
    async deleteById(barcode) {
      await db.separate_items.where('barcode').equals(barcode).delete()
      return ok(null, null)
    },
    async clearAll() {
      await db.separate_items.clear()
      return ok(null, null)
    }
  },

  scanHistory: {
    async logBatch(scans) {
      const timestamp = nowIso()
      for (const s of scans) {
        await db.scan_history.add({
          barcode: s.barcode,
          itemNumber: s.item_number,
          itemName: s.item_name,
          action: s.action,
          boxId: s.box_id,
          created_at: timestamp
        })
      }
      return ok({ count: scans.length }, null)
    }
  },

  settings: {
    // Подтягивает монотонный счётчик (box_counter/pallet_counter) минимум до minValue.
    // Нужно после импорта готовых контейнеров с «историческими» номерами:
    // nextCounter инициализируется от max() только при пустом счётчике,
    // а существующий меньший счётчик иначе выдаст уже занятый номер.
    async ensureCounterAtLeast(key, minValue) {
      try {
        const stored = await db.settings.get(key)
        const cur = stored?.value
        if (typeof cur !== 'number' || !Number.isFinite(cur) || cur < minValue) {
          await db.settings.put({ key, value: minValue })
        }
        return ok(null, null)
      } catch (e) {
        return err(e?.message || 'counter failed')
      }
    }
  },

  backup: {
    // Полный дамп всех таблиц для файла резервной копии (JSON).
    // Строки отдаются как есть — ключи на месте, восстановление идёт bulkPut'ом 1-в-1.
    async exportAll() {
      try {
        const tables = {}
        for (const t of db.tables) {
          tables[t.name] = await t.toArray()
        }
        return ok({ version: 1, exportedAt: nowIso(), tables }, null)
      } catch (e) {
        return err(e?.message || 'backup failed')
      }
    },
    // Восстановление из дампа: валидация → атомарная замена всех таблиц в транзакции.
    // Старые схемы (v1/v2, PK status) отвергаем — такой дамп нам создать негде.
    async importAll(dump) {
      const names = db.tables.map((t) => t.name)
      if (!dump || dump.version !== 1 || !dump.tables) {
        return err('Не похоже на файл резервной копии')
      }
      for (const name of names) {
        if (!Array.isArray(dump.tables[name])) return err(`В копии нет таблицы ${name}`)
      }
      const boxes = dump.tables.boxes || []
      if (boxes.some((b) => !b || typeof b.id !== 'string' || 'key' in b)) {
        return err('Копия от старой версии приложения — восстановление невозможно')
      }
      try {
        await db.transaction('rw', db.tables, async () => {
          await Promise.all(db.tables.map((t) => t.clear()))
          for (const t of db.tables) {
            const rows = dump.tables[t.name] || []
            if (rows.length > 0) await t.bulkPut(rows)
          }
        })
        const restored = {}
        for (const name of names) restored[name] = (dump.tables[name] || []).length
        return ok({ restored }, null)
      } catch (e) {
        return err(e?.message || 'restore failed')
      }
    }
  },

  pallets: {
    async getAll() {
      return ok(await db.pallets.toArray())
    },
    async getById(palletId) {
      const row = await db.pallets.get(palletId)
      if (!row) return err('Not found')
      return ok(row, null)
    },
    async create() {
      // Без справочной БД паллет создавать нельзя.
      const noDb = await requireBrainDatabase()
      if (noDb) return noDb
      // Монотонный счётчик, как у коробов: номера паллет не повторяются
      // при частичных очистках.
      const pallet_number = await nextCounter('pallet_counter', db.pallets, 'pallet_number')
      const row = {
        id: generateId(),
        status: 'active',
        pallet_number,
        name: `Паллет №${pallet_number}`,
        seal: '',
        created_at: nowIso()
      }
      await db.pallets.add(row)
      return ok({ id: row.id, pallet_number }, null)
    },
    async update(palletId, payload = {}) {
      try {
        const all = await db.pallets.toArray()
        const existing = all.find((r) => r.id === palletId) || null
        if (!existing) return err('Not found')
        // v3: primary key таблицы — id, поэтому обновление делаем через put() по ключу.
        const updated = { ...existing, ...payload, updated_at: nowIso() }
        // Дату завершения ставим здесь, а не у вызывающих: иначе finished_at
        // остаётся пустым и список показывает «Invalid Date завершён».
        if (payload.status === 'finished' && !existing.finished_at) {
          updated.finished_at = nowIso()
        }
        await db.pallets.put(updated)
        return ok(updated, null)
      } catch (e) {
        console.error('[db.pallets.update] FAILED', palletId, e)
        throw e
      }
    },
    async delete(palletId) {
      await db.pallet_items.where({ palletId }).delete()
      await db.pallets.delete(palletId)
      return ok(null, null)
    },
    async clearAll() {
      await db.pallet_items.clear()
      await db.pallets.clear()
      return ok(null, null)
    }
  },

  palletItems: {
    async getByPalletId(palletId) {
      const rows = await db.pallet_items.where('palletId').equals(palletId).toArray()
      return ok(
        rows.map((r) => ({
          source_type: r.source_type,
          source_id: r.source_id,
          item_barcode: r.item_barcode,
          item_name: r.item_name,
          item_brand: r.item_brand,
          item_comment: r.item_comment,
          scanned_at: r.scanned_at,
          order_num: r.order_num
        }))
      )
    },
    async create(palletId, sourceType, sourceId) {
      const dup = await db.pallet_items
        .where({
          palletId,
          source_type: sourceType,
          source_id: sourceId
        })
        .first()
      if (dup) return err('duplicate')
      const key = await db.pallet_items.add({
        palletId,
        source_type: sourceType,
        source_id: sourceId,
        item_barcode: '',
        item_name: '',
        item_brand: '',
        item_comment: '',
        scanned_at: nowIso(),
        order_num: 0
      })
      return ok({ id: key }, null)
    },
    async addInline(palletId, itemData) {
      const number = itemData.number || ''
      const key = await db.pallet_items.add({
        palletId,
        source_type: 'inline',
        source_id: number,
        item_barcode: number,
        item_name: itemData.name || 'Товар',
        item_brand: itemData.article || '',
        item_comment: itemData.comment || '',
        scanned_at: nowIso(),
        order_num: 0
      })
      return ok({ id: key }, null)
    },
    // Все строки для карты «микс/товар → паллет» (колонка места в таблице брака)
    async getAll() {
      return ok(await db.pallet_items.toArray())
    },
    // Поиск inline-товара по штрихкоду в чужих паллетах, включая завершённые.
    // Нужно для проверки дубликатов: in-memory стор видит только активные паллеты,
    // а уникального индекса по barcode у pallet_items нет (в отличие от box_items).
    async findInlineByBarcode(barcodes, excludePalletId) {
      const targets = new Set((Array.isArray(barcodes) ? barcodes : [barcodes]).filter(Boolean))
      if (targets.size === 0) return ok(null)
      for (const b of [...targets]) {
        const p = parseBarcodeToBrainNumber(b)
        if (p) targets.add(p)
      }
      const row =
        (await db.pallet_items
          .filter((r) => {
            if (!r || r.source_type !== 'inline') return false
            if (excludePalletId && r.palletId === excludePalletId) return false
            const code = r.item_barcode || r.source_id
            if (!code) return false
            if (targets.has(code)) return true
            const p = parseBarcodeToBrainNumber(code)
            return !!p && targets.has(p)
          })
          .first()) || null
      if (!row) return ok(null)
      const pallet = await db.pallets.get(row.palletId).catch(() => null)
      return ok({
        palletId: row.palletId,
        pallet_number: pallet?.pallet_number ?? pallet?.number ?? null,
        pallet_name: pallet?.name ?? null
      })
    },
    async delete(palletId, sourceType, sourceId) {
      await db.pallet_items
        .where({ palletId, source_type: sourceType, source_id: sourceId })
        .delete()
      return ok(null, null)
    },
    // Поиск микса в чужих паллетах, включая завершённые.
    // Нужно чтобы микс, уже упакованный в один паллет, нельзя было
    // добавить в другой: in-memory стор видит только текущий паллет.
    async findBoxUsage(boxId, excludePalletId) {
      if (boxId === undefined || boxId === null) return ok(null)
      const key = String(boxId)
      const row =
        (await db.pallet_items
          .filter(
            (r) =>
              !!r &&
              r.source_type === 'box' &&
              !(excludePalletId && r.palletId === excludePalletId) &&
              (r.source_id === boxId || String(r.source_id) === key)
          )
          .first()) || null
      if (!row) return ok(null)
      const pallet = await db.pallets.get(row.palletId).catch(() => null)
      return ok({
        palletId: row.palletId,
        pallet_number: pallet?.pallet_number ?? pallet?.number ?? null,
        pallet_name: pallet?.name ?? null
      })
    }
  }
}

export default dbStore
