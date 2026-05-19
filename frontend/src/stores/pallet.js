import { defineStore } from 'pinia'
import { ref, computed, triggerRef } from 'vue'
import { usePalletLoading } from './pallet/loading.js'
import { usePalletCrud } from './pallet/crud.js'
import { usePalletSync } from './pallet/sync.js'

/**
 * Store для управления паллетами (server-first).
 * Данные хранятся на сервере. localStorage — только сессия + UI.
 *
 * Разбит на composables:
 * - loading.js: загрузка данных с сервера
 * - crud.js: создание, добавление, удаление
 * - sync.js: завершение, undo, дубликаты, очистка
 */
export const usePalletStore = defineStore('pallet', () => {
  // State
  const pallets = ref([])
  const currentPallet = ref(null)
  const availableBoxes = ref([])
  const availableSeparateItems = ref([])
  const isSyncing = ref(false)
  const syncError = ref(null)
  const actionHistory = ref([])

  /** Явный trigger для форсированного обновления computed properties в UI */
  const palletItemsVersion = ref(0)

  function triggerPalletItemsUpdate() {
    palletItemsVersion.value++
    triggerRef(palletItemsVersion)
  }

  // Сначала инициализируем loading — он не зависит от других
  const loadingCtx = {
    pallets,
    currentPallet,
    availableBoxes,
    availableSeparateItems
  }
  const loading = usePalletLoading(loadingCtx)

  // Затем crud — ему нужен loadActivePalletById из loading
  const crudCtx = {
    currentPallet,
    actionHistory,
    isSyncing,
    syncError,
    triggerPalletItemsUpdate,
    loadActivePalletById: loading.loadActivePalletById
  }
  const crud = usePalletCrud(crudCtx)

  // Затем sync — зависит от state
  const syncCtx = {
    pallets,
    currentPallet,
    actionHistory,
    isSyncing,
    syncError,
    triggerPalletItemsUpdate,
    availableBoxes,
    availableSeparateItems
  }
  const sync = usePalletSync(syncCtx)

  /* ============================================================
  Вычисляемые
  ============================================================ */
  const canUndo = computed(() => currentPallet.value && actionHistory.value.length > 0)
  const totalPallets = computed(() => pallets.value.length)
  const currentPalletItemCount = computed(() =>
    currentPallet.value ? currentPallet.value.items.length : 0
  )
  const hasAvailableBoxes = computed(() => availableBoxes.value.length > 0)
  const hasAvailableSeparateItems = computed(() => availableSeparateItems.value.length > 0)

  return {
    // State
    pallets,
    currentPallet,
    availableBoxes,
    availableSeparateItems,
    isSyncing,
    syncError,
    // Computed
    totalPallets,
    currentPalletItemCount,
    hasAvailableBoxes,
    hasAvailableSeparateItems,
    canUndo,
    palletItemsVersion,
    triggerPalletItemsUpdate,
    // Loading
    loadPallets: loading.loadPallets,
    loadAvailableBoxes: loading.loadAvailableBoxes,
    refreshAvailableBoxItems: loading.refreshAvailableBoxItems,
    loadAvailableSeparateItems: loading.loadAvailableSeparateItems,
    loadActivePallet: loading.loadActivePallet,
    loadActivePalletById: loading.loadActivePalletById,
    loadAllActivePallets: loading.loadAllActivePallets,
    // CRUD
    createPallet: crud.createPallet,
    addBoxToPallet: crud.addBoxToPallet,
    addSeparateItemToPallet: crud.addSeparateItemToPallet,
    addInlineItemToPallet: crud.addInlineItemToPallet,
    removeItemFromPallet: crud.removeItemFromPallet,
    cancelCurrentPallet: crud.cancelCurrentPallet,
    // Sync
    checkGlobalDuplicate: sync.checkGlobalDuplicate,
    finishCurrentPallet: sync.finishCurrentPallet,
    undoLastAction: sync.undoLastAction,
    clearAllPallets: sync.clearAllPallets,
    clearAllPalletsFromBackend: sync.clearAllPalletsFromBackend,
    getAllPalletItems: sync.getAllPalletItems
  }
})
