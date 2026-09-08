import { dbStore as db } from '@/lib/db.js'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'

/**
 * Общий индекс мест хранения товаров.
 * byBarcode: штрихкод (сырой и нормализованный) → {
 *   label, // «М3», «П1», «М3 → П1», «Отд»
 *   kind, // 'box' | 'pallet-inline' | 'separate'
 *   boxId, boxNumber, palletId, palletNumber
 * }
 * Строится один раз на экран, дальше — резолв через Map без запросов.
 */
export async function buildLocationIndex() {
  const byBarcode = new Map()
  const set = (barcode, entry) => {
    if (!barcode) return
    if (!byBarcode.has(barcode)) byBarcode.set(barcode, entry)
    const parsed = parseBarcodeToBrainNumber(barcode)
    if (parsed && !byBarcode.has(parsed)) byBarcode.set(parsed, entry)
  }

  const boxesRes = await db.boxes.getAll()
  const boxNum = new Map((boxesRes.data || []).map((b) => [b.id, b.box_number]))
  const palletsRes = await db.pallets.getAll()
  const palletNum = new Map((palletsRes.data || []).map((p) => [p.id, p.pallet_number]))

  const boxToPallet = new Map() // boxId → { palletId, palletNumber }
  const inlineToPallet = new Map() // code → { palletId, palletNumber }
  const palletItemsRes = await db.palletItems.getAll()
  for (const r of palletItemsRes.data || []) {
    const pn = palletNum.get(r.palletId)
    if (pn == null) continue
    if (r.source_type === 'box' && r.source_id != null && !boxToPallet.has(r.source_id)) {
      boxToPallet.set(r.source_id, { palletId: r.palletId, palletNumber: pn })
    } else if (r.source_type === 'inline' || r.source_type === 'pallet') {
      const code = String(r.item_barcode || r.source_id || '')
      if (code && !inlineToPallet.has(code)) {
        inlineToPallet.set(code, { palletId: r.palletId, palletNumber: pn })
      }
    }
  }

  const boxItemsRes = await db.boxItems.getAll()
  for (const r of boxItemsRes.data || []) {
    const bn = boxNum.get(r.boxId)
    if (bn == null || !r.barcode) continue
    const pal = boxToPallet.get(r.boxId)
    set(r.barcode, {
      label: pal ? `М${bn} → П${pal.palletNumber}` : `М${bn}`,
      kind: 'box',
      boxId: r.boxId,
      boxNumber: bn,
      palletId: pal?.palletId ?? null,
      palletNumber: pal?.palletNumber ?? null
    })
  }

  for (const [code, pal] of inlineToPallet) {
    set(code, {
      label: `П${pal.palletNumber}`,
      kind: 'pallet-inline',
      boxId: null,
      boxNumber: null,
      palletId: pal.palletId,
      palletNumber: pal.palletNumber
    })
  }

  const sepRes = await db.separateItems.getAll()
  for (const i of sepRes.data || []) {
    if (i.barcode) {
      set(i.barcode, {
        label: 'Отд',
        kind: 'separate',
        boxId: null,
        boxNumber: null,
        palletId: null,
        palletNumber: null
      })
    }
  }

  return { byBarcode }
}

export function lookupLocation(index, barcode) {
  if (!index) return null
  return index.byBarcode.get(String(barcode || '')) || null
}
