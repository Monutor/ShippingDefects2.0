<script setup>
import { ref } from 'vue'
import { displayStoreNumber, setStoreProfile } from '@/lib/storeProfile'

const number = ref('')
const seal = ref('')
const saving = ref(false)

async function save() {
  const n = number.value.trim()
  const s = seal.value.trim()
  if (!/^\d{3}$/.test(n)) {
    window.showToast('Номер магазина — ровно 3 цифры', 4000, 'error')
    return
  }
  if (!s) {
    window.showToast('Пломба не может быть пустой', 4000, 'error')
    return
  }
  saving.value = true
  try {
    await setStoreProfile(n, s)
    window.showToast('Магазин сохранён', 1000, 'success')
    // Перезапуск применяет профиль ко всем загрузкам данных и снимает блокировку
    window.setTimeout(() => window.location.reload(), 600)
  } catch (err) {
    saving.value = false
    window.showToast(err.message || 'Не удалось сохранить', 4000, 'error')
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-900 p-4 flex items-center justify-center">
    <div class="w-full max-w-md">
      <div
        class="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-4 space-y-4"
      >
        <div>
          <h2 class="text-lg font-semibold text-slate-100">Магазин</h2>
          <p class="text-sm text-slate-400 mt-1">
            Текущий: S{{ displayStoreNumber() }} — не настроен
          </p>
        </div>
        <div class="space-y-3">
          <div>
            <label class="block text-sm text-slate-400 mb-1">Номер магазина (3 цифры)</label>
            <input
              v-model="number"
              type="text"
              inputmode="numeric"
              maxlength="3"
              placeholder="123"
              class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-primary-500"
            />
          </div>
          <div>
            <label class="block text-sm text-slate-400 mb-1">Текст пломбы</label>
            <input
              v-model="seal"
              type="text"
              placeholder="Пример: ОП № 123 г. Воронеж"
              class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>
        <Button variant="primary" block :disabled="saving" @click="save">Сохранить</Button>
        <p class="text-xs text-slate-500">
          На одном устройстве работает один магазин. После сохранения приложение перезапустится и
          сканирование станет доступно.
        </p>
      </div>
    </div>
  </div>
</template>
