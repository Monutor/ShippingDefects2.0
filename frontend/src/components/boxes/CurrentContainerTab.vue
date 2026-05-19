<script setup>
import { useRouter } from 'vue-router'
import { usePalletStore } from '@/stores/pallet'
import { Button, Loader } from '@/components/ui'

const props = defineProps({
  isLoading: { type: Boolean, default: false }
})

const router = useRouter()
const palletStore = usePalletStore()
</script>

<template>
  <div class="p-4">
    <Loader v-if="isLoading" text="Загрузка..." />

    <div v-else-if="palletStore.currentPallet" class="space-y-4">
      <div
        class="bg-gradient-to-br from-emerald-600/20 to-teal-700/20 border border-emerald-500/30 rounded-2xl p-4"
      >
        <div class="flex items-center gap-3 mb-3">
          <span class="text-2xl">📦</span>
          <div>
            <h4 class="text-lg font-bold text-emerald-300">
              {{ palletStore.currentPallet.name }}
            </h4>
            <p class="text-sm text-emerald-400/70">
              {{ (palletStore.currentPallet.items || []).length }} товаров
            </p>
          </div>
        </div>
        <Button block variant="success" @click="router.push('/pallet')"
          >📋 Перейти к паллету</Button
        >
      </div>
    </div>

    <div v-else class="empty-state py-8">
      <span class="text-5xl">📭</span>
      <p class="text-slate-400 mt-4">Нет текущего паллета</p>
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
</style>
