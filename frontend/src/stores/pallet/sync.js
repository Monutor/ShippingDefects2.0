import { db } from '@/lib/api.js'
import { isAdmin as checkIsAdmin } from '@/config'
import { parseBarcodeToBrainNumber } from '@/utils/barcode'
import { showError } from '@/utils/showError'

/**
 * Composable для синхронизации, undo и проверки дубликатов.
 */
export function usePalletSync(context) {
  const { pallets, currentPallet, actionHistory, isSyncing, syncError, triggerPalletItemsUpdate } =
    context

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

    return null
  }

  async function finishCurrentPallet() {
    if (!currentPallet.value || currentPallet.value.items.length === 0) return null
    isSyncing.value = true
    syncError.value = null
    const originalPallet = JSON.parse(JSON.stringify(currentPallet.value))
    let finishSuccess = false
    let backendResult = null
    try {
      const itemsToSend = currentPallet.value.items.map((i) => ({
        source_type: i.source_type,
        source_id: i.source_id,
        name: i.name && i.name.trim() ? i.name : `Товар ${i.source_id || ''}`,
        article: i.article || '',
        comment: i.comment || '',
        scanned_at: i.scannedAt || null
      }))

      if (navigator.onLine && currentPallet.value.backendId) {
        let result = null
        try {
          result = await db.pallets.update(currentPallet.value.backendId, {
            status: 'finished',
            items: itemsToSend
          })
        } catch (updateErr) {
          if (updateErr?.code === '23505' || updateErr?.detail?.includes('duplicate')) {
            result = { data: null, error: null }
          } else {
            throw updateErr
          }
        }

        if (result?.error) {
          if (result.error.code === 403 && result.error.message?.includes('создан')) {
            showError(result.error.message, 'Паллет уже создан или завершён')
            try {
              const freshResult = await db.pallets.getById(currentPallet.value.id)
              if (freshResult?.data && freshResult.data.status === 'finished') {
                backendResult = freshResult.data
                finishSuccess = true
                result.error = null
              } else {
                throw new Error(result.error.message)
              }
            } catch (fetchErr) {
              syncError.value = `Паллет завершён на сервере, но не удалось загрузить данные: ${fetchErr.message}`
              window.showToast(`⚠️ Паллет уже завершён`, 3000, 'warning')
            } finally {
              isSyncing.value = false
            }
          } else if (result.error.code === 403) {
            syncError.value = `Ошибка прав доступа: ${result.error.message}`
            window.showToast(`⚠️ Ошибка прав доступа`, 3000, 'warning')
          } else {
            throw new Error(result.error.message)
          }
        } else if (result?.success === false || result?.error) {
          // unused errorMsg removed (dead code fix)
        }

        backendResult = result.data
        finishSuccess = true
      } else if (!navigator.onLine && currentPallet.value.backendId) {
        finishSuccess = true
      }
    } catch (error) {
      syncError.value = `Не удалось завершить паллет: ${error.message}`
      if (!error.message?.includes('создан')) {
        window.showToast(`⚠️ Не удалось завершить паллет`)
      }
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

        if (
          navigator.onLine &&
          currentPallet.value.backendId &&
          itemToRemove.source_type &&
          itemToRemove.source_id
        ) {
          try {
            const result = await db.palletItems.delete(
              currentPallet.value.backendId,
              itemToRemove.source_type,
              itemToRemove.source_id
            )
            if (result?.error) {
              currentPallet.value.items.splice(idx, 0, itemToRemove)
              actionHistory.value.push(lastAction)
              window.showToast(`⚠️ Не удалось отменить: ${result.error || 'ошибка сервера'}`)
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
    window.showToast('🗑 Паллеты удалены на сервере, данные очищены')
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
