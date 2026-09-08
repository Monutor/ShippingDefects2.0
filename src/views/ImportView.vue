<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBrainStore } from '@/stores/brain'
import { useBoxesStore } from '@/stores/boxes'
import { useSeparateStore } from '@/stores/separate'
import { usePalletStore } from '@/stores/pallet'
import { Button, NavBar, FileUpload } from '@/components/ui'
import {
  IMPORT_TYPES,
  readContainerWorkbook,
  detectContainerType,
  parseMixSheet,
  parseSeparateSheet,
  parsePalletSheet,
  createImportReport,
  importMix,
  importSeparate,
  importPallet
} from '@/utils/containerImport'

const router = useRouter()
const brainStore = useBrainStore()
const boxesStore = useBoxesStore()
const separateStore = useSeparateStore()
const palletStore = usePalletStore()

const stage = ref('idle') // idle | ready | importing | done
const error = ref(null)
const fileName = ref('')
const detected = ref(null) // { type, number }
const preview = ref(null) // parsed rows
const previewCounts = ref(null)
const report = ref(null)
const uploadKey = ref(0)

const typeTitle = computed(() => {
  if (!detected.value) return ''
  if (detected.value.type === IMPORT_TYPES.MIX) return `Микс-Короб №${detected.value.number ?? '—'}`
  if (detected.value.type === IMPORT_TYPES.PALLET) return `Паллет №${detected.value.number ?? '—'}`
  return 'Отдельные товары'
})

async function handleFileSelect(file) {
  if (!file) return
  error.value = null
  report.value = null
  preview.value = null
  stage.value = 'idle'

  try {
    const parsed = await readContainerWorkbook(file)
    const info = detectContainerType(parsed)
    if (!info.type) {
      throw new Error('Не похоже на выгрузку приложения: нет листов «Товары» / «Содержимое»')
    }
    fileName.value = file.name
    detected.value = info
    if (info.type === IMPORT_TYPES.MIX) {
      const rows = parseMixSheet(parsed.sheets['Товары'])
      preview.value = rows
      previewCounts.value = { rows: rows.length }
    } else if (info.type === IMPORT_TYPES.SEPARATE) {
      const rows = parseSeparateSheet(parsed.sheets['Товары'])
      preview.value = rows
      previewCounts.value = { rows: rows.length }
    } else {
      const data = parsePalletSheet(parsed.sheets['Содержимое'])
      preview.value = data
      previewCounts.value = {
        mixes: data.mixes.length,
        mixItems: data.mixes.reduce((n, m) => n + m.items.length, 0),
        separate: data.separateItems.length,
        inline: data.inlineItems.length
      }
    }
    if ((previewCounts.value.rows ?? 1) === 0) throw new Error('В файле нет строк с товарами')
    if (
      detected.value.type === IMPORT_TYPES.PALLET &&
      !previewCounts.value.mixes &&
      !previewCounts.value.separate &&
      !previewCounts.value.inline
    ) {
      throw new Error('В файле паллеты нет содержимого')
    }
    stage.value = 'ready'
  } catch (err) {
    error.value = err.message || 'Не удалось прочитать файл'
    window.showToast('Ошибка чтения файла')
  }
}

async function runImport() {
  if (!preview.value || !detected.value) return
  error.value = null
  stage.value = 'importing'
  const rep = createImportReport(fileName.value, detected.value.type)
  try {
    const brainSet = new Set((brainStore.items || []).map((i) => i.number).filter(Boolean))
    if (detected.value.type === IMPORT_TYPES.MIX) {
      await importMix(preview.value, detected.value.number, brainSet, rep)
      await boxesStore.loadBoxes()
    } else if (detected.value.type === IMPORT_TYPES.SEPARATE) {
      await importSeparate(preview.value, brainSet, rep)
      await separateStore.loadSeparateItems()
    } else {
      await importPallet(preview.value, detected.value.number, brainSet, rep)
      await boxesStore.loadBoxes()
      await separateStore.loadSeparateItems()
      await palletStore.loadPallets()
    }
    report.value = rep
    stage.value = 'done'
    window.showToast('Импорт завершён', 2500, 'success')
  } catch (err) {
    error.value = err.message || 'Импорт не удался'
    report.value = rep
    stage.value = 'done'
    window.showToast('Импорт завершён с ошибкой')
  }
}

function resetAll() {
  stage.value = 'idle'
  error.value = null
  fileName.value = ''
  detected.value = null
  preview.value = null
  previewCounts.value = null
  report.value = null
  uploadKey.value++
}

function goToResult() {
  if (!report.value) return
  if (report.value.type === IMPORT_TYPES.PALLET) router.push('/pallet-view')
  else if (report.value.type === IMPORT_TYPES.SEPARATE) router.push('/separate')
  else router.push('/boxes')
}
</script>

<template>
  <div
    class="import-view min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 pb-20"
  >
    <NavBar title="Импорт" left-text="Назад" left-arrow @click-left="$router.back()" />

    <main class="content px-4 py-4 max-w-[500px] w-full mx-auto">
      <!-- Без базы брака импорт заблокирован: номера не с чем сверять -->
      <div
        v-if="!brainStore.hasDatabase"
        class="bg-amber-900/30 border border-amber-600/50 rounded-2xl p-4 mb-4"
      >
        <p class="text-amber-200 text-sm font-medium mb-1">Сначала загрузите базу брака</p>
        <p class="text-amber-200/70 text-xs mb-3">
          Импорт сверяет номера с базой и не может создавать миксы/паллеты без неё
        </p>
        <Button size="sm" @click="$router.push('/')">На главную</Button>
      </div>

      <!-- Выбор файла -->
      <div v-if="stage === 'idle' || stage === 'ready'">
        <FileUpload :key="uploadKey" accept=".xlsx,.xls" @change="handleFileSelect">
          <div
            class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mb-4 shadow-lg shadow-primary-500/30"
          >
            <span class="text-3xl">📥</span>
          </div>
          <p class="text-slate-100 font-semibold text-center px-4">Выберите выгрузку</p>
          <span class="text-slate-400 text-sm mt-2">Микс_*, Отдельные_* или Паллет_*.xlsx</span>
        </FileUpload>

        <div v-if="error" class="error-message">
          <p>{{ error }}</p>
        </div>
      </div>

      <!-- Превью распознанного файла -->
      <div
        v-if="stage === 'ready' && detected"
        class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 mt-4"
      >
        <p class="text-xs text-slate-500 break-all mb-1">{{ fileName }}</p>
        <h3 class="font-semibold text-slate-100 text-lg">{{ typeTitle }}</h3>
        <div class="text-sm text-slate-400 mt-2 space-y-1">
          <template v-if="detected.type !== IMPORT_TYPES.PALLET">
            <p>Строк с товарами: {{ previewCounts.rows }}</p>
          </template>
          <template v-else>
            <p>Миксов: {{ previewCounts.mixes }} (товаров: {{ previewCounts.mixItems }})</p>
            <p>Отдельных: {{ previewCounts.separate }}</p>
            <p>Товаров паллеты: {{ previewCounts.inline }}</p>
          </template>
        </div>
        <p class="text-xs text-slate-500 mt-3">
          Товары, которых нет в базе брака, будут импортированы и показаны в отчёте. Дубли
          пропустятся. Импортированные миксы и паллеты сразу станут завершёнными.
        </p>
        <div class="flex gap-2 mt-4">
          <Button class="flex-1" @click="runImport">Импортировать</Button>
          <Button variant="secondary" @click="resetAll">Отмена</Button>
        </div>
      </div>

      <!-- Прогресс -->
      <div
        v-if="stage === 'importing'"
        class="bg-slate-800/80 border border-slate-700 rounded-2xl p-8 mt-4 text-center"
      >
        <p class="text-slate-100 font-medium">Импортируем…</p>
        <p class="text-slate-500 text-sm mt-1">Не закрывайте страницу</p>
      </div>

      <!-- Отчёт -->
      <div v-if="stage === 'done' && report" class="mt-4 space-y-3">
        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4">
          <h3 class="font-semibold text-slate-100 mb-2">Готово: {{ report.fileName }}</h3>
          <div v-if="report.created.length" class="space-y-1">
            <p v-for="(c, i) in report.created" :key="'c' + i" class="text-sm text-emerald-300">
              ✅ {{ c.name }} — добавлено: {{ c.items }}
            </p>
          </div>
          <div v-if="report.reused.length" class="space-y-1 mt-2">
            <p v-for="(c, i) in report.reused" :key="'r' + i" class="text-sm text-slate-300">
              ↩️ {{ c.name }} уже был — дозаполнено: {{ c.items }}
            </p>
          </div>
          <p v-if="!report.created.length && !report.reused.length" class="text-sm text-slate-400">
            Ничего нового не создано
          </p>
        </div>

        <div
          v-if="report.remapped.length"
          class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4"
        >
          <h4 class="font-medium text-slate-200 text-sm mb-2">Номера были заняты — выданы новые</h4>
          <p v-for="(m, i) in report.remapped" :key="i" class="text-sm text-slate-400">
            {{ m.kind === 'box' ? 'Микс' : 'Паллет' }} №{{ m.from }} → №{{ m.to }}
          </p>
        </div>

        <div
          v-if="report.unknown.length"
          class="bg-amber-900/30 border border-amber-600/50 rounded-2xl p-4"
        >
          <h4 class="font-medium text-amber-200 text-sm mb-2">
            Нет в базе брака (импортированы): {{ report.unknown.length }}
          </h4>
          <div class="max-h-40 overflow-y-auto space-y-1">
            <p v-for="(u, i) in report.unknown" :key="i" class="text-xs text-amber-200/80">
              {{ u.barcode }} — {{ u.name }}
            </p>
          </div>
        </div>

        <div
          v-if="report.skippedDuplicates.length"
          class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4"
        >
          <h4 class="font-medium text-slate-200 text-sm mb-2">
            Пропущены (уже есть): {{ report.skippedDuplicates.length }}
          </h4>
          <div class="max-h-40 overflow-y-auto space-y-1">
            <p v-for="(d, i) in report.skippedDuplicates" :key="i" class="text-xs text-slate-400">
              {{ d.barcode }} — уже в: {{ d.where }}
            </p>
          </div>
        </div>

        <div
          v-if="report.errors.length"
          class="bg-red-900/30 border border-red-600/50 rounded-2xl p-4"
        >
          <h4 class="font-medium text-red-200 text-sm mb-2">Ошибки: {{ report.errors.length }}</h4>
          <div class="max-h-40 overflow-y-auto space-y-1">
            <p v-for="(e, i) in report.errors" :key="i" class="text-xs text-red-200/80">{{ e }}</p>
          </div>
        </div>

        <div v-if="error" class="error-message">
          <p>{{ error }}</p>
        </div>

        <div class="flex gap-2">
          <Button class="flex-1" @click="goToResult">Перейти к данным</Button>
          <Button variant="secondary" @click="resetAll">Ещё файл</Button>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.import-view {
  padding-bottom: 140px;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 0.75rem;
  padding: 1rem;
  margin-top: 1rem;
}

.error-message p {
  color: #f87171;
  font-size: 0.875rem;
  margin: 0;
}
</style>
