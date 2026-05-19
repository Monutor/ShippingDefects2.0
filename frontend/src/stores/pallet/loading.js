import { db } from '@/lib/api.js'

/**
 * Composable для загрузки данных паллетов.
 * Принимает контекст store и возвращает функции загрузки.
 */
export function usePalletLoading(context) {
  const {
    pallets,
    currentPallet,
    availableBoxes,
    availableSeparateItems
  } = context

  async function loadPallets() {
    try {
      if (!navigator.onLine) return []
      const result = await db.pallets.getAll()
      if (result.error) return []

      pallets.value = (result.data || [])
        .filter((p) => p.status === 'finished')
        .map((p) => ({
          id: p.id,
          number: p.pallet_number || 0,
          name: p.name || `Паллет ${p.pallet_number}`,
          collector_id: p.collector_id,
          seal: p.seal || null,
          status: p.status,
          createdAt: p.created_at,
          finishedAt: p.finished_at,
          items: []
        }))

      await Promise.all(
        pallets.value.map(async (pallet) => {
          if (pallet.status === 'finished') {
            try {
              const itemsResult = await db.palletItems.getByPalletId(pallet.id)
              const allItems = itemsResult.data || []
              pallet.items = allItems
              pallet.boxCount = allItems.filter((i) => i.source_type === 'box').length
              pallet.separateItemCount = allItems.filter(
                (i) => i.source_type === 'separate_item'
              ).length
              pallet.inlineCount = allItems.filter(
                (i) => i.source_type === 'pallet' || i.source_type === 'inline'
              ).length
            } catch {
              // ignore
            }
          }
        })
      )
      return pallets.value
    } catch {
      return []
    }
  }

  async function loadAvailableBoxes() {
    try {
      if (!navigator.onLine) {
        availableBoxes.value = []
        return []
      }
      const result = await db.boxes.getAll()
      if (result.error) {
        availableBoxes.value = []
        return []
      }

      const finishedBoxes = (result.data || []).filter((b) => b.status === 'finished')
      availableBoxes.value = finishedBoxes.map((box) => ({
        id: box.id,
        number: box.box_number || 0,
        name: box.name || `Микс ${box.box_number}`,
        collector_id: box.collector_id,
        itemCount: null,
        itemsLoaded: false,
        items: []
      }))
      return availableBoxes.value
    } catch {
      availableBoxes.value = []
      return []
    }
  }

  async function refreshAvailableBoxItems(boxId) {
    const box = availableBoxes.value.find((b) => b.id === boxId)
    if (!box || box.itemsLoaded) return box

    try {
      if (!navigator.onLine) return box

      const itemsResult = await db.boxItems.getByBoxId(boxId)
      const items = (itemsResult.data || []).map((item) => ({
        number: item.barcode,
        name: item.name,
        article: item.brand || '',
        comment: item.comment || '',
        scannedAt: item.created_at
      }))

      box.items = items
      box.itemCount = items.length
      box.itemsLoaded = true
      return box
    } catch {
      box.itemCount = 0
      return box
    }
  }

  async function loadAvailableSeparateItems() {
    try {
      if (!navigator.onLine) {
        availableSeparateItems.value = []
        return []
      }
      const result = await db.separateItems.getAll()
      if (result.error) {
        availableSeparateItems.value = []
        return []
      }

      availableSeparateItems.value = (result.data || []).map((item) => ({
        id: item.id,
        number: item.barcode,
        name: item.name,
        article: item.brand || '',
        comment: item.comment || ''
      }))
      return availableSeparateItems.value
    } catch {
      availableSeparateItems.value = []
      return []
    }
  }

  async function loadActivePallet() {
    try {
      if (!navigator.onLine) return null
      const result = await db.pallets.getAll()
      if (result.error) return null

      const activePallets = (result.data || []).filter((p) => p.status === 'active')
      if (activePallets.length === 0) return null

      const { useCollectorStore } = await import('@/stores/collector')
      const collectorStore = useCollectorStore()
      const myPallets = activePallets.filter((p) => p.collector_id === collectorStore.employeeId)
      myPallets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const myPallet = myPallets[0] || null

      if (myPallet && currentPallet.value && currentPallet.value.backendId === myPallet.id) {
        return currentPallet.value
      }

      if (!myPallet) {
        return null
      }
      return loadActivePalletById(myPallet, result.data)
    } catch {
      return null
    }
  }

  async function loadActivePalletById(pallet, allData) {
    let serverItems = []
    try {
      const itemsResult = await db.palletItems.getByPalletId(pallet.id)
      if (itemsResult?.data) {
        const boxItems = itemsResult.data.filter((i) => i.source_type === 'box')
        const otherItems = itemsResult.data.filter((i) => i.source_type !== 'box')

        for (const boxRef of boxItems) {
          try {
            const boxResult = await db.boxes.getById(boxRef.source_id)
            if (boxResult?.data) {
              const boxItemsResult = await db.boxItems.getByBoxId(boxRef.source_id)
              const boxItemsList = boxItemsResult?.data || []

              const undoId = crypto.randomUUID
                ? crypto.randomUUID()
                : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
              serverItems.push({
                source_type: 'box',
                source_id: boxRef.source_id,
                order_num: boxResult.data.box_number || 0,
                _full_data: boxItemsList.length > 0 ? { items: boxItemsList } : null,
                _undoId: undoId,
                _boxNumber: boxResult.data.box_number || 0,
                _boxName: boxResult.data.name || `Микс ${boxResult.data.box_number}`,
                _boxItemCount: boxItemsList.length
              })
            }
          } catch (err) {}
        }

        serverItems = serverItems.concat(
          otherItems
            .map((i) => {
              const isTimestamp =
                typeof i.source_id === 'number' ||
                (typeof i.source_id === 'string' &&
                  !isNaN(Number(i.source_id)) &&
                  Number(i.source_id) > 1700000000000)

              if (isTimestamp && (!i.item_name || i.item_name.trim() === '') && !i.item_barcode)
                return null

              const name = i.item_name && i.item_name.trim() ? i.item_name : `Товар ${i.source_id}`
              return {
                source_type:
                  i.source_type === 'pallet' || i.source_type === 'inline'
                    ? 'pallet'
                    : i.source_type,
                source_id: i.source_id,
                originalSourceType: i.source_type,
                barcode: i.item_barcode || '',
                name: name,
                article: i.item_brand && i.item_brand.trim() ? i.item_brand : '',
                comment: i.item_comment && i.item_comment.trim() ? i.item_comment : '',
                scannedAt: i.scanned_at || ''
              }
            })
            .filter(Boolean)
        )
      }
    } catch {
      // ignore
    }

    currentPallet.value = {
      id: pallet.id,
      number: pallet.pallet_number || 0,
      name: `Паллет ${pallet.pallet_number}`,
      createdAt: pallet.created_at,
      backendId: pallet.id,
      status: 'active',
      items: serverItems
    }
    return currentPallet.value
  }

  async function loadAllActivePallets() {
    try {
      if (!navigator.onLine) return []
      const result = await db.pallets.getAll()
      if (result.error) return []

      const activePallets = (result.data || []).filter((p) => p.status === 'active')
      if (
        currentPallet.value &&
        currentPallet.value.backendId &&
        !activePallets.some((p) => p.id === currentPallet.value.id)
      ) {
        currentPallet.value = null
      }

      const palletsWithItems = await Promise.all(
        activePallets.map(async (pallet) => {
          let serverItems = []
          try {
            const itemsResult = await db.palletItems.getByPalletId(pallet.id)
            if (itemsResult?.data) {
              serverItems = itemsResult.data
                .filter((i) => i.source_type !== 'box')
                .map((i) => {
                  const isTimestamp =
                    typeof i.source_id === 'number'
                      ? String(i.source_id).length >= 13 &&
                        !isNaN(Number(i.source_id)) &&
                        Number(i.source_id) > 1700000000000
                      : typeof i.source_id === 'string' &&
                        /^\d{13,}$/.test(i.source_id) &&
                        !isNaN(Number(i.source_id)) &&
                        Number(i.source_id) > 1700000000000

                  const name = i.item_name && i.item_name.trim() ? i.item_name : null

                  if (isTimestamp && !name && !i.item_barcode) return null

                  return {
                    source_type:
                      i.source_type === 'pallet' || i.source_type === 'inline'
                        ? 'pallet'
                        : i.source_type,
                    source_id: i.source_id,
                    barcode: i.item_barcode || '',
                    name: name || `Товар ${i.source_id}`,
                    article: i.item_brand && i.item_brand.trim() ? i.item_brand : '',
                    comment: i.item_comment && i.item_comment.trim() ? i.item_comment : ''
                  }
                })
                .filter(Boolean)

              if (currentPallet.value && currentPallet.value.id === pallet.id) {
                const localItemCount = currentPallet.value.items?.length || 0
                const serverItemCount = serverItems.length

                if (localItemCount > 0 && localItemCount >= serverItemCount) {
                } else if (currentPallet.value.id === pallet.id && localItemCount === 0) {
                  currentPallet.value.items = serverItems
                } else {
                }
              }
            }
          } catch (err) {
            console.error('[pallet/loading] failed to fetch box items for pallet enrichment:', err)
          }
          return { ...pallet, items: serverItems, createdAt: pallet.created_at }
        })
      )
      return palletsWithItems
    } catch {
      return []
    }
  }

  return {
    loadPallets,
    loadAvailableBoxes,
    refreshAvailableBoxItems,
    loadAvailableSeparateItems,
    loadActivePallet,
    loadActivePalletById,
    loadAllActivePallets
  }
}
