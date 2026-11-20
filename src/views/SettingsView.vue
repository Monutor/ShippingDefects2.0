<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Button, NavBar, Modal } from '@/components/ui'
import { dbStore } from '@/lib/db'
import {
  storeProfile,
  displayStoreNumber,
  currentSealText,
  setStoreProfile
} from '@/lib/storeProfile'

const router = useRouter()
const showResetModal = ref(false)
const showRestoreModal = ref(false)
const showStoreModal = ref(false)
const storeNumberInput = ref('')
const storeSealInput = ref('')
const restoreFile = ref(null)
const restoreSummary = ref(null)
const storageInfo = ref({ size: null, warning: false })

async function updateStorageInfo() {
  const res = await dbStore.backup.exportAll()
  if (res.error) return
  const json = JSON.stringify(res.data)
  const bytes = new Blob([json]).size
  storageInfo.value.size = bytes
  storageInfo.value.warning = bytes > 50 * 1024 * 1024
}

onMounted(() => {
  updateStorageInfo()
})

async function confirmReset() {
  await dbStore.resetLocalData()
  showResetModal.value = false
  window.showToast('✅ Локальные данные очищены. Перезагрузка…')
  setTimeout(() => window.location.reload(), 600)
}

async function confirmStoreChange() {
  const n = storeNumberInput.value.trim()
  const s = storeSealInput.value.trim()
  if (!/^\d{3}$/.test(n)) {
    window.showToast('Номер магазина — ровно 3 цифры', 4000, 'error')
    return
  }
  if (!s) {
    window.showToast('Пломба не может быть пустой', 4000, 'error')
    return
  }
  try {
    // Смена только пломбы — данные целы; смена номера — полный сброс
    if (storeProfile.value && n === storeProfile.value.number) {
      await setStoreProfile(n, s)
      showStoreModal.value = false
      window.showToast('✅ Пломба обновлена')
      return
    }
    await dbStore.resetLocalData()
    await setStoreProfile(n, s)
    showStoreModal.value = false
    window.showToast('Магазин изменён. Перезагрузка…')
    setTimeout(() => window.location.reload(), 600)
  } catch (err) {
    window.showToast(err.message || 'Не удалось сохранить', 4000, 'error')
  }
}

function openStoreModal() {
  storeNumberInput.value = storeProfile.value ? storeProfile.value.number : ''
  storeSealInput.value = storeProfile.value ? storeProfile.value.sealText : ''
  showStoreModal.value = true
}

async function downloadBackup() {
  const result = await dbStore.backup.exportAll()
  if (result.error) {
    window.showToast('Не удалось создать копию')
    return
  }
  try {
    const blob = new Blob([JSON.stringify(result.data)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    // Метка с датой и временем: прежнее имя вида backup_ГГГГ-ММ-ДД.json
    // совпадало при повторном скачивании в тот же день, и браузер молча
    // дописывал «(1)» — найти нужную копию было невозможно.
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
    link.download = `backup_${stamp}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    window.showToast('Резервная копия скачана', 2500, 'success')
  } catch {
    window.showToast('Не удалось скачать копию')
  }
}

function onRestoreFilePicked(e) {
  const file = e.target?.files?.[0]
  e.target.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const dump = JSON.parse(reader.result)
      const t = dump?.tables
      if (dump?.version !== 1 || !t) throw new Error('bad format')
      restoreFile.value = dump
      restoreSummary.value = {
        name: file.name,
        date: dump.exportedAt ? new Date(dump.exportedAt).toLocaleString('ru-RU') : '—',
        brain: (t.brain_items || []).length,
        boxes: (t.boxes || []).length,
        pallets: (t.pallets || []).length,
        separate: (t.separate_items || []).length
      }
      showRestoreModal.value = true
    } catch {
      window.showToast('Файл не похож на резервную копию')
    }
  }
  reader.onerror = () => window.showToast('Не удалось прочитать файл')
  reader.readAsText(file)
}

async function confirmRestore() {
  if (!restoreFile.value) return
  const result = await dbStore.backup.importAll(restoreFile.value)
  showRestoreModal.value = false
  restoreFile.value = null
  if (result.error) {
    window.showToast(`Не восстановлено: ${result.error.message}`)
    return
  }
  window.showToast('✅ Копия восстановлена. Перезагрузка…')
  setTimeout(() => window.location.reload(), 600)
}
</script>

<template>
  <div class="settings-page">
    <NavBar title="Настройки" left-text="Назад" left-arrow @click-left="$router.back()" />

    <main class="px-4 py-4 max-w-[500px] w-full mx-auto space-y-4">
      <!-- Магазин -->
      <div class="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold text-slate-100">Магазин</h3>
              <span
                class="text-xs font-mono bg-primary-500/15 text-primary-400 border border-primary-500/30 rounded-lg px-2 py-0.5"
                >S{{ displayStoreNumber() }}</span
              >
            </div>
            <p class="text-sm text-slate-400 mt-1 break-words">{{ currentSealText() }}</p>
          </div>
          <Button variant="secondary" size="sm" @click="openStoreModal">Изменить</Button>
        </div>
      </div>

      <!-- Импорт готовых данных -->
      <div class="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-slate-100">Готовые миксы и паллеты</h3>
            <p class="text-sm text-slate-400 mt-1">
              Импорт из выгрузок Микс_* / Паллет_* / Отдельные_*
            </p>
          </div>
          <Button variant="secondary" size="sm" @click="router.push('/import')">Импорт</Button>
        </div>
      </div>

      <!-- Резервная копия -->
      <div class="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-4">
        <h3 class="font-semibold text-slate-100">Резервная копия</h3>
        <p class="text-sm text-slate-400 mt-1 mb-3">
          Сохраните все данные в файл, чтобы восстановить их на этом или другом устройстве
        </p>
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" class="flex-1" @click="downloadBackup">
            Скачать копию
          </Button>
          <Button variant="secondary" size="sm" class="flex-1" @click="restoreInput.click()">
            Восстановить
          </Button>
        </div>
        <input
          ref="restoreInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onRestoreFilePicked"
        />
      </div>

      <!-- Хранилище -->
      <div class="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-4">
        <h3 class="font-semibold text-slate-100">Хранилище</h3>
        <p class="text-sm text-slate-400 mt-1 mb-2">Приблизительный размер локальной БД</p>
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-300">
            {{ storageInfo.size ? (storageInfo.size / 1024 / 1024).toFixed(2) + ' МБ' : '—' }}
          </span>
          <Button variant="secondary" size="sm" @click="updateStorageInfo">Обновить</Button>
        </div>
        <p v-if="storageInfo.warning" class="text-amber-400 text-xs mt-2">
          ⚠️ Размер > 50 МБ — рекомендуется сделать резервную копию и очистить старые данные
        </p>
      </div>

      <!-- Очистка данных -->
      <div class="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-slate-100">Очистка данных</h3>
            <p class="text-sm text-slate-400 mt-1">Удалить все локальные данные и начать заново</p>
          </div>
          <Button variant="danger" size="sm" @click="showResetModal = true">Сбросить</Button>
        </div>
      </div>
    </main>

    <Modal
      v-model="showRestoreModal"
      title="Восстановить копию?"
      show-cancel
      confirm-text="Восстановить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmRestore"
    >
      <p class="text-slate-400 text-center">
        Текущие данные будут <b>полностью заменены</b> содержимым копии.
      </p>
      <div v-if="restoreSummary" class="text-sm text-slate-300 mt-3 space-y-1">
        <p class="text-slate-500 text-xs break-all">{{ restoreSummary.name }}</p>
        <p>Создана: {{ restoreSummary.date }}</p>
        <p>База брака: {{ restoreSummary.brain }}</p>
        <p>Миксов: {{ restoreSummary.boxes }}</p>
        <p>Паллет: {{ restoreSummary.pallets }}</p>
        <p>Отдельных: {{ restoreSummary.separate }}</p>
      </div>
    </Modal>

    <Modal
      v-model="showResetModal"
      title="Сбросить данные?"
      show-cancel
      confirm-text="Сбросить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmReset"
    >
      <p class="text-slate-400 text-center">
        Вы уверены? Это удалит все локальные данные: короба, паллеты, товары и историю.
      </p>
      <p class="text-rose-400 text-sm text-center mt-2 font-medium">
        ⚠️ Это действие нельзя отменить.
      </p>
    </Modal>

    <!-- Магазин: смена -->
    <Modal
      v-model="showStoreModal"
      title="Магазин"
      show-cancel
      confirm-text="Сохранить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmStoreChange"
    >
      <div class="text-left space-y-3">
        <div>
          <label class="block text-xs text-slate-400 mb-1">Номер магазина (3 цифры)</label>
          <input
            v-model="storeNumberInput"
            type="text"
            inputmode="numeric"
            maxlength="3"
            class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-primary-500"
          />
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1">Текст пломбы</label>
          <input
            v-model="storeSealInput"
            type="text"
            class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-primary-500"
          />
        </div>
        <p class="text-xs text-rose-400">
          Смена магазина сотрёт все локальные данные: миксы, паллеты, отдельные, базу брака и
          историю. Отменить это нельзя.
        </p>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.settings-page {
  padding-bottom: 140px;
  min-height: 100vh;
}
</style>
