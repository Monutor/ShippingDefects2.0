import { auth, db } from '@/lib/api.js'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { showError } from '@/utils/showError'

/** Safe deep clone — избегает ошибок при circular references */
function safeDeepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj))
  } catch {
    return structuredClone(obj)
  }
}

/**
 * Composable для CRUD операций паллетов.
 */
export function usePalletCrud(context) {
  const {
    currentPallet,
    actionHistory,
    isSyncing,
    syncError,
    triggerPalletItemsUpdate,
    loadActivePalletById
  } = context

  async function createPallet() {
    if (currentPallet.value) return currentPallet.value
    isSyncing.value = true
    syncError.value = null
    try {
      const userId = auth.getUserId()
      const result = await db.pallets.create(userId)
      if (result.error) throw new Error(result.error.message || 'Не удалось создать паллет')
      const serverPallet = result.data
      currentPallet.value = {
        id: serverPallet.id,
        number: serverPallet.pallet_number || 0,
        name: `Паллет ${serverPallet.pallet_number}`,
        createdAt: new Date().toISOString(),
        backendId: serverPallet.id,
        status: 'active',
        items: []
      }
      return currentPallet.value
    } catch (error) {
      syncError.value = `Не удалось создать паллет`
      showError(error.message, 'Не удалось создать паллет. Попробуйте снова.')
      return null
    } finally {
      isSyncing.value = false
    }
  }

  async function addBoxToPallet(box) {
    if (!currentPallet.value || !box.id) return false
    const exists = currentPallet.value.items.some(
      (i) => i.source_type === 'box' && i.source_id === box.id
    )
    if (exists) return false
    let palletId = null
    if (!currentPallet.value.backendId) {
      const createResult = await createPallet()
      if (!createResult || !createResult.backendId) return false
      palletId = createResult.backendId
    } else {
      palletId = currentPallet.value.backendId
    }
    if (navigator.onLine && palletId) {
      try {
        const result = await db.palletItems.create(palletId, 'box', box.id)
        if (!result?.data?.id) throw new Error('Не удалось добавить в паллет')
      } catch (err) {
        if (err?.code === '23505' || /duplicate/i.test(err.message)) {
          return { success: false, error: 'duplicate', message: 'Этот микс уже в паллете' }
        }
        if (err?.error === 'duplicate_in_active_pallet') {
          return {
            success: false,
            error: 'duplicate_in_active_pallet',
            message: err.message,
            pallet_number: err.pallet_number
          }
        }
        showError(err.message, 'Не удалось сохранить товар в паллет')
        return false
      }
    }
    const undoId = crypto.randomUUID
      ? crypto.randomUUID()
      : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const boxWithItems = {
      source_type: 'box',
      source_id: box.id,
      order_num: box.number,
      _full_data: box.items && box.items.length > 0 ? { items: safeDeepClone(box.items) } : null,
      _undoId: undoId,
      _boxNumber: box.number,
      _boxName: box.name,
      _boxItemCount: (box.items && box.items.length) || 0
    }
    currentPallet.value.items.push(boxWithItems)
    actionHistory.value.push({ type: 'add_item', item: boxWithItems, timestamp: Date.now() })
    if (actionHistory.value.length > 50) actionHistory.value.shift()
    triggerPalletItemsUpdate()
    return true
  }

  async function addSeparateItemToPallet(item) {
    if (!currentPallet.value || !item.id) return false
    const exists = currentPallet.value.items.some(
      (i) => i.source_type === 'separate_item' && i.source_id === item.id
    )
    if (exists) return false
    let palletId = null
    if (!currentPallet.value.backendId) {
      const createResult = await createPallet()
      if (!createResult || !createResult.backendId) return false
      palletId = createResult.backendId
    } else {
      palletId = currentPallet.value.backendId
    }
    if (navigator.onLine && palletId) {
      try {
        const result = await db.palletItems.create(palletId, 'separate_item', item.id)
        if (!result?.data?.id) throw new Error('Не удалось добавить в паллет')
      } catch (err) {
        showError(err.message, 'Не удалось сохранить товар в паллет')
        return false
      }
    }
    const undoId = crypto.randomUUID
      ? crypto.randomUUID()
      : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    currentPallet.value.items.push({
      source_type: 'separate_item',
      source_id: item.id,
      comment: item.comment || '',
      scannedAt: item.scannedAt || null,
      _undoId: undoId
    })
    actionHistory.value.push({
      type: 'add_item',
      item: {
        source_type: 'separate_item',
        source_id: item.id,
        comment: item.comment || '',
        scannedAt: item.scannedAt || null
      },
      timestamp: Date.now()
    })
    if (actionHistory.value.length > 50) actionHistory.value.shift()
    triggerPalletItemsUpdate()
    return true
  }

  async function addInlineItemToPallet(itemData) {
    if (!currentPallet.value || !itemData.number) return false

    const parsedNumber = parseBarcodeToBrainNumber(itemData.number)
    const exists = currentPallet.value.items.some((i) => {
      if (i.barcode === itemData.number) return true
      if (i.source_id && String(i.source_id) === itemData.number) return true
      if (parsedNumber && i.source_id && String(i.source_id) === parsedNumber) return true
      return false
    })
    if (exists) return false
    let palletId = null
    if (!currentPallet.value.backendId && navigator.onLine) {
      const result = await db.pallets.getAll()
      if (result?.data) {
        const { useCollectorStore } = await import('@/stores/collector')
        const collectorStore = useCollectorStore()
        const myActivePallets = (result.data || []).filter(
          (p) => p.status === 'active' && p.collector_id === collectorStore.employeeId
        )
        myActivePallets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        if (myActivePallets.length > 0) {
          currentPallet.value = await loadActivePalletById(myActivePallets[0], result.data)
          if (currentPallet.value?.backendId) {
            palletId = currentPallet.value.backendId
          }
        }
      }
    }
    if (!palletId && !currentPallet.value?.backendId) {
      const createResult = await createPallet()
      if (!createResult || !createResult.backendId) return false
      palletId = createResult.backendId
    } else {
      palletId = currentPallet.value.backendId
    }
    let serverResult = null
    if (navigator.onLine && palletId && itemData.name) {
      try {
        serverResult = await db.palletItems.addInline(palletId, {
          ...itemData,
          source_type: 'inline'
        })
        if (serverResult?.error) {
          if (
            serverResult.error.code === 409 ||
            /duplicate/i.test(serverResult.error.message || '')
          ) {
            const palletInfo = serverResult.detail?.pallet_info || serverResult.pallet_info
            let msg = `⚠️ Товар уже в паллете: ${itemData.number}`
            if (palletInfo?.pallet_number) {
              msg += ` (Паллет №${palletInfo.pallet_number})`
            }
            window.showToast(msg, 5000, 'error')
            return { success: false, error: 'duplicate', pallet_info: palletInfo }
          } else {
            showError(serverResult.error.message, 'Не удалось сохранить товар на сервере')
          }
        }
      } catch (err) {
        showError(err.message, 'Не удалось сохранить товар на сервере')
        serverResult = { error: true }
      }
    }
    const undoId = crypto.randomUUID
      ? crypto.randomUUID()
      : `undo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const itemRef = {
      source_type: 'inline',
      source_id: itemData.number,
      barcode: itemData.number,
      name: itemData.name || '',
      article: itemData.article || '',
      comment: itemData.comment || '',
      scannedAt: new Date().toISOString()
    }
    const serverOk = !navigator.onLine || !serverResult?.error
    if (serverOk) {
      const newItem = { ...itemRef, _undoId: undoId }
      actionHistory.value.push({ type: 'add_item', item: newItem, timestamp: Date.now() })
      if (actionHistory.value.length > 50) actionHistory.value.shift()

      const newItems = [...currentPallet.value.items, newItem]

      currentPallet.value = {
        id: currentPallet.value.id,
        number: currentPallet.value.number,
        name: currentPallet.value.name,
        createdAt: currentPallet.value.createdAt,
        backendId: currentPallet.value.backendId,
        status: 'active',
        items: newItems,
        _updatedAt: Date.now()
      }

      triggerPalletItemsUpdate()
    } else {
      return false
    }
    return { success: true }
  }

  async function removeItemFromPallet(item) {
    if (!currentPallet.value || !currentPallet.value.items) return false

    const index = currentPallet.value.items.findIndex(
      (i) => i.source_id === item.source_id && i.source_type === item.source_type
    )
    if (index === -1) return false

    const itemToRemove = currentPallet.value.items[index]

    currentPallet.value.items.splice(index, 1)

    if (
      navigator.onLine &&
      currentPallet.value.backendId &&
      itemToRemove.source_type &&
      itemToRemove.source_id
    ) {
      try {
        const st = itemToRemove.originalSourceType || itemToRemove.source_type
        const result = await db.palletItems.delete(
          currentPallet.value.backendId,
          st,
          itemToRemove.source_id
        )
        if (result?.error || result?.success === false) {
          showError(result.error || 'неизвестная ошибка', 'Не удалось удалить товар с сервера')
          currentPallet.value.items.splice(index, 0, itemToRemove)
          return false
        }
      } catch (err) {
        showError(err.message, 'Не удалось удалить товар с сервера')
        currentPallet.value.items.splice(index, 0, itemToRemove)
        return false
      }
    }

    return true
  }

  async function cancelCurrentPallet() {
    if (!currentPallet.value || !currentPallet.value.backendId) {
      currentPallet.value = null
      return
    }

    if (navigator.onLine) {
      const itemsToDelete = [...(currentPallet.value.items || [])]
      await Promise.all(
        itemsToDelete.map((item) => {
          const st = item.originalSourceType || item.source_type
          return db.palletItems
            .delete(currentPallet.value.backendId, st, item.source_id)
            .catch(() => {})
        })
      )
    }

    currentPallet.value.items = []
  }

  return {
    createPallet,
    addBoxToPallet,
    addSeparateItemToPallet,
    addInlineItemToPallet,
    removeItemFromPallet,
    cancelCurrentPallet
  }
}
