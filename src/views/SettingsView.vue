<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, NavBar, Modal } from '@/components/ui'
import { dbStore } from '@/lib/db'

const router = useRouter()
const showResetModal = ref(false)

async function confirmReset() {
  await dbStore.resetLocalData()
  showResetModal.value = false
  window.showToast('✅ Локальные данные очищены. Перезагрузка…')
  setTimeout(() => window.location.reload(), 600)
}
</script>

<template>
  <div class="settings-page">
    <NavBar title="Настройки" left-text="Назад" left-arrow @click-left="$router.back()" />

    <main class="px-4 py-4 max-w-[500px] w-full mx-auto space-y-4">
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
  </div>
</template>

<style scoped>
.settings-page {
  padding-bottom: 140px;
  min-height: 100vh;
}
</style>
