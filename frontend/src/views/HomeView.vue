<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBrainStore } from '@/stores/brain'
import { readExcelFile, getColumnHeaders } from '@/utils/excel'
import { FileUpload } from '@/components/ui'

const router = useRouter()
const brainStore = useBrainStore()

const isLoading = ref(false)
const error = ref(null)

async function handleFileSelect(file) {
  if (!file) return

  // Проверяем авторизацию перед загрузкой БД
  const userData = localStorage.getItem('warehouse-brain-user')
  if (!userData) {
    window.showToast('⚠️ Сначала войдите в систему')
    router.push('/login')
    return
  }

  isLoading.value = true
  error.value = null

  try {
    const rawData = await readExcelFile(file)

    if (rawData.length === 0) {
      throw new Error('Файл пуст или не содержит данных')
    }

    const headers = getColumnHeaders(rawData)

    if (headers.length === 0) {
      throw new Error('Не найдено колонок в файле')
    }

    // Автомаппинг колонок
    const mapping = autoMapColumns(headers)
    if (!mapping) {
      throw new Error(
        'Не удалось определить колонку "номер" в файле. Убедитесь, что в первой строке есть колонка с заголовком "номер" или "номер этикетки".'
      )
    }

    // Сохраняем базу
    await brainStore.setDatabase(rawData, mapping)

    window.showToast(`База загружена: ${rawData.length} товаров`)

    // Перенаправляем на страницу просмотра базы
    setTimeout(() => {
      router.push('/upload')
    }, 500)
  } catch (err) {
    error.value = err.message
    window.showToast('Ошибка: ' + err.message)
  } finally {
    isLoading.value = false
  }
}

function autoMapColumns(headers) {
  const lowerHeaders = headers.map((h) => h.toLowerCase())

  let numberIndex = lowerHeaders.findIndex((h) => h === 'номер')
  if (numberIndex === -1) {
    numberIndex = lowerHeaders.findIndex((h) =>
      ['номер этикетки', 'number', 'номер брака'].some((kw) => h.includes(kw))
    )
  }

  // Если не нашли колонку номера — не фоллбачим на headers[0], а возвращаем null
  if (numberIndex === -1) {
    return null
  }

  let nameIndex = lowerHeaders.findIndex((h) => h === 'наименование')
  if (nameIndex === -1) {
    nameIndex = lowerHeaders.findIndex((h) =>
      ['название', 'товар', 'product', 'описание', 'наименование товара'].some((kw) =>
        h.includes(kw)
      )
    )
  }

  let articleIndex = lowerHeaders.findIndex((h) =>
    ['код товара', 'артикул', 'sku', 'code'].some((kw) => h.includes(kw))
  )

  const commentKeywords = ['комментарий', 'comment', 'примечание', 'note', 'замечание']
  const commentIndex = lowerHeaders.findIndex((h) => commentKeywords.some((kw) => h.includes(kw)))

  return {
    barcode: '',
    // L5: name fallback на headers[4] || headers[0] — работает для стандартных Excel файлов.
    // Если формат специфичный → пользователь должен вручную маппить колонки в UI
    name: nameIndex !== -1 ? headers[nameIndex] : headers[4] || headers[0],
    article: articleIndex !== -1 ? headers[articleIndex] : '',
    number: numberIndex !== -1 ? headers[numberIndex] : headers[0],
    comment: commentIndex !== -1 ? headers[commentIndex] : ''
  }
}
</script>

<template>
  <div class="home-page">
    <!-- Header -->
    <div class="header">
      <div class="header-icon">📦</div>
      <h1 class="header-title">Учёт брака</h1>
      <p class="header-subtitle">Система складского учёта</p>
    </div>

    <!-- Уведомление о загрузке -->
    <div class="upload-notice">
      <div class="notice-icon">💡</div>
      <p class="notice-text">Загрузите Excel файл (.xlsx) со списком бракованных товаров</p>
    </div>

    <!-- Загрузка файла -->
    <div class="upload-section">
      <FileUpload accept=".xlsx,.xls" :loading="isLoading" @change="handleFileSelect" />

      <!-- Ошибка -->
      <div v-if="error" class="error-message">
        <van-icon name="warning-o" size="24" color="#f87171" />
        <p>{{ error }}</p>
      </div>
    </div>

    <p class="menu-hint">Используйте меню внизу для навигации</p>
  </div>
</template>

<style scoped>
.home-page {
  padding: 2rem 1rem;
  padding-bottom: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
}

/* Header */
.header {
  text-align: center;
  margin-bottom: 2rem;
}

.header-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.header-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: #f1f5f9;
  margin-bottom: 0.5rem;
}

.header-subtitle {
  color: #94a3b8;
  font-size: 1rem;
  margin-bottom: 1.5rem;
}

/* Upload notice */
.upload-notice {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 1rem;
  padding: 1rem 1.5rem;
  margin-bottom: 1.5rem;
  max-width: 500px;
}

.notice-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.notice-text {
  color: #fbbf24;
  font-size: 0.875rem;
  line-height: 1.4;
  margin: 0;
}

/* Upload section */
.upload-section {
  width: 100%;
  max-width: 500px;
  margin-bottom: 1.5rem;
}

/* Error message */
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

/* Menu hint */
.menu-hint {
  color: #64748b;
  font-size: 0.875rem;
  font-style: italic;
  margin-top: auto;
}
</style>
