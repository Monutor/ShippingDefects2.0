import { dbStore as db } from '@/lib/db.js'
import { isAdmin as checkIsAdmin } from '@/config'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'

/**
 * Composable для синхронизации, undo и проверки дубликатов.
 */
export function usePalletSync(context) {
  const { pallets, currentPallet, actionHistory, isSyncing, syncError } = context

  async function checkGlobalDuplicate(scannedBarcode) {
    const parsedNumber = parseBarcodeToBrainNumber(scannedBarcode)
    const searchNumbers = new Set([scannedBarcode])
    if (parsedNumber && parsedNumber !== scannedBarcode) searchNumbers.add(parsedNumber)

    for (const pallet of pallets.value) {
      if (!pallet.items || pallet.status !== 'active') continue
      for (const item of pallet.items) {
        const itemParsed = parseBarcodeToBrainNumber(item.barcode)
        const normalizedItemNumbers = new Set([item.barcode, itemParsed].filter(Boolean))
        for (const searchNum of searchNumbers) {
          if (normalizedItemNumbers.has(searchNum)) {
            return {
              boxNumber: pallet.number || pallet.pallet_number,
              boxName: pallet.name,
              type: 'pallet'
            }
          }
        }
      }
    }

    if (currentPallet.value) {
      for (const item of currentPallet.value.items) {
        const itemParsed = parseBarcodeToBrainNumber(item.barcode)
        const normalizedItemNumbers = new Set([item.barcode, itemParsed].filter(Boolean))
        for (const searchNum of searchNumbers) {
          if (normalizedItemNumbers.has(searchNum)) {
            return {
              boxNumber: currentPallet.value.number || '',
              boxName: 'текущий',
              type: 'pallet'
            }
          }
        }
      }
    }

    try {
      const { useBoxesStore } = await import('@/stores/boxes')
      const boxesStore = useBoxesStore()

      for (const box of boxesStore.boxes) {
        if (!box.items) continue
        for (const item of box.items) {
          const itemParsed = parseBarcodeToBrainNumber(item.number)
          const normalizedItemNumbers = new Set([item.number, itemParsed].filter(Boolean))
          for (const searchNum of searchNumbers) {
            if (normalizedItemNumbers.has(searchNum)) {
              return { boxNumber: box.number, boxName: box.name, type: 'box' }
            }
          }
        }
      }

      if (boxesStore.currentBox && boxesStore.currentBox.items) {
        for (const item of boxesStore.currentBox.items) {
          const itemParsed = parseBarcodeToBrainNumber(item.number)
          const normalizedItemNumbers = new Set([item.number, itemParsed].filter(Boolean))
          for (const searchNum of searchNumbers) {
            if (normalizedItemNumbers.has(searchNum)) {
              return {
                boxNumber: boxesStore.currentBox.number,
                boxName: 'текущий микс',
                type: 'box'
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }

    // DB-фолбэк: миксы, которых нет в памяти (завершённые, незагруженные).
    // БД — источник истины: без этого товар из завершённого микса проходит как новый (дубль).
    try {
      const found = await db.boxItems.findByBarcode([...searchNumbers])
      if (found?.data?.box_number != null) {
        return { boxNumber: found.data.box_number, boxName: found.data.box_name, type: 'box' }
      }
    } catch {
      // ignore — in-memory проверка выше уже отработала
    }

    // DB-фолбэк: inline-товары в других паллетах, включая завершённые
    // (in-memory цикл выше видит только активные).
    try {
      const found = await db.palletItems.findInlineByBarcode(
        [...searchNumbers],
        currentPallet.value?.backendId || null
      )
      if (found?.data?.pallet_number != null) {
        return {
          boxNumber: found.data.pallet_number,
          boxName: found.data.pallet_name,
          type: 'pallet'
        }
      }
    } catch {
      // ignore
    }

    return null
  }

  async function finishCurrentPallet() {
    if (!currentPallet.value || currentPallet.value.items.length === 0) return null
    if (isSyncing.value) return null
    isSyncing.value = true
    syncError.value = null
    const originalPallet = JSON.parse(JSON.stringify(currentPallet.value))
    let finishSuccess = false
    let backendResult = null
    try {
      if (currentPallet.value.backendId) {
        const result = await db.pallets.update(currentPallet.value.backendId, {
          status: 'finished'
        })
        if (result.error) throw new Error(result.error.message || result.error)
        backendResult = result.data
        finishSuccess = true
      } else {
        finishSuccess = true
      }
    } catch (error) {
      syncError.value = `Не удалось завершить паллет: ${error.message}`
      window.showToast(`⚠️ Не удалось завершить паллет`)
    } finally {
      isSyncing.value = false
    }
    if (finishSuccess && currentPallet.value) {
      const finishedPallet = {
        ...originalPallet,
        backendId: currentPallet.value.backendId,
        status: 'finished',
        createdAt:
          backendResult?.created_at || backendResult?.createdAt || originalPallet.createdAt,
        finishedAt:
          backendResult?.finished_at || backendResult?.finishedAt || originalPallet.finishedAt,
        seal: backendResult?.seal || null,
        palletId: backendResult?.palletId || currentPallet.value.id,
        items: backendResult?.items || originalPallet.items
      }

      pallets.value.push(finishedPallet)

      currentPallet.value = null
      return finishedPallet
    }
    return null
  }

  async function undoLastAction() {
    if (!currentPallet.value || !actionHistory.value.length) return null
    const lastAction = actionHistory.value.pop()

    if (lastAction.type === 'add_item') {
      if (!lastAction.item) return null

      const idx = currentPallet.value.items.findIndex(
        (i) =>
          i.source_type === lastAction.item.source_type && i.source_id === lastAction.item.source_id
      )
      if (idx !== -1) {
        const itemToRemove = currentPallet.value.items[idx]
        currentPallet.value.items.splice(idx, 1)

        if (currentPallet.value.backendId && itemToRemove.source_type && itemToRemove.source_id) {
          try {
            const result = await db.palletItems.delete(
              currentPallet.value.backendId,
              itemToRemove.source_type,
              itemToRemove.source_id
            )
            if (result?.error) {
              currentPallet.value.items.splice(idx, 0, itemToRemove)
              actionHistory.value.push(lastAction)
              window.showToast(`⚠️ Не удалось отменить: ${result.error || 'неизвестная ошибка'}`)
            }
          } catch (err) {
            currentPallet.value.items.splice(idx, 0, itemToRemove)
            actionHistory.value.push(lastAction)
            window.showToast(`⚠️ Не удалось отменить: ${err.message}`)
          }
        }

        return lastAction.item || null
      }
    }

    return null
  }

  async function clearAllPallets() {
    if (!checkIsAdmin()) {
      window.showToast('⚠️ Очищать общую базу может только администратор')
      return { success: false, error: 'Только админ' }
    }
    isSyncing.value = true
    try {
      const result = await db.pallets.clearAll()
      if (result.error) {
        window.showToast(`❌ Ошибка очистки базы`)
        return { success: false, error: result.error.message }
      }
      pallets.value = []
      context.availableBoxes.value = []
      context.availableSeparateItems.value = []
      currentPallet.value = null
      return { success: true }
    } catch (error) {
      window.showToast(`❌ Ошибка очистки базы`)
      return { success: false, error: error.message }
    } finally {
      isSyncing.value = false
    }
  }

  function clearAllPalletsFromBackend() {
    pallets.value = []
    currentPallet.value = null
    context.availableBoxes.value = []
    context.availableSeparateItems.value = []
    window.showToast('🗑 Паллеты удалены, данные очищены')
  }

  function getAllPalletItems() {
    const result = []
    for (const pallet of pallets.value) {
      if (pallet.items) {
        for (const item of pallet.items) {
          const name = item.item_name || item.name || 'Товар'
          const article = item.item_brand || item.brand || ''
          result.push({
            palletName: pallet.name || 'Паллет',
            type: item.source_type || '',
            number: item.barcode || String(item.source_id),
            name: name,
            article: article,
            scannedAt: item.scanned_at || null
          })
        }
      }
    }
    return result
  }

  return {
    checkGlobalDuplicate,
    finishCurrentPallet,
    undoLastAction,
    clearAllPallets,
    clearAllPalletsFromBackend,
    getAllPalletItems
  }
}
