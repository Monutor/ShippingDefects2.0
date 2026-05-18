<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCollectorStore } from '@/stores/collector'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useBoxesStore } from '@/stores/boxes'
import { usePalletStore } from '@/stores/pallet'
import { useBrainStore } from '@/stores/brain'
import { auth, db } from '@/lib/api.js'
import { isAdmin } from '@/config'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Modal from '@/components/ui/Modal.vue'

const router = useRouter()
const collectorStore = useCollectorStore()
const maintenanceStore = useMaintenanceStore()
const boxesStore = useBoxesStore()
const palletStore = usePalletStore()
const brainStore = useBrainStore()

// Проверка прав админа
const isUserAdmin = computed(() => isAdmin())

// Проверка авторизации
const isAuthenticated = computed(() => {
  return !!localStorage.getItem('warehouse-brain-user')
})

// Данные профиля
const employeeId = computed(() => collectorStore.employeeId)
const fullName = computed(() => collectorStore.fullName)
const position = computed(() => collectorStore.position)

// Статистика
const stats = ref({
  totalBoxes: 0,
  totalSeparateItems: 0,
  totalPallets: 0,
  lastScanAt: null
})

// Редактирование
const isEditing = ref(false)
const editForm = ref({
  fullName: '',
  position: ''
})

const showEditModal = ref(false)

// Загрузка статистики
onMounted(() => {
  if (isAuthenticated.value) {
    loadStats()
  }
})

async function loadStats() {
  // Server-first: статистика только с бэкенда (никакого localStorage кэша)
  if (navigator.onLine) {
    try {
      const [boxesResult, separateResult, palletsResult] = await Promise.all([
        db.boxes.getAll(),
        db.separateItems.getAll(),
        db.pallets.getAll()
      ])
      if (!boxesResult.error && boxesResult.data?.length) {
        stats.value.totalBoxes = boxesResult.data.filter((b) => b.status === 'finished').length
      }
      if (!separateResult.error && separateResult.data?.length) {
        stats.value.totalSeparateItems = separateResult.data.length
      }
      if (!palletsResult.error && palletsResult.data?.length) {
        stats.value.totalPallets = palletsResult.data.filter((p) => p.status === 'finished').length
      }
    } catch (err) {}
  }
}

function openEditModal() {
  editForm.value.fullName = collectorStore.fullName
  editForm.value.position = collectorStore.position
  showEditModal.value = true
}

async function saveProfile() {
  if (!editForm.value.fullName.trim()) {
    window.showToast('Введите ФИО')
    return
  }

  // Обновляем данные в store
  collectorStore.setCollectorData({
    employeeId: collectorStore.employeeId,
    fullName: editForm.value.fullName.trim(),
    position: editForm.value.position.trim() || 'Сборщик'
  })

  // Сохраняем в localStorage — ВАЖНО: сохраняем и token тоже
  const existingUser = JSON.parse(localStorage.getItem('warehouse-brain-user') || '{}')
  const savedToken = existingUser.token || null

  localStorage.setItem(
    'warehouse-brain-user',
    JSON.stringify({
      employeeId: collectorStore.employeeId,
      fullName: editForm.value.fullName.trim(),
      position: editForm.value.position.trim() || 'Сборщик',
      is_admin: existingUser.is_admin || false,
      token: savedToken,
      authenticatedAt: new Date().toISOString()
    })
  )

  // Синхронизация профиля с бэкендом (прямой PUT)
  try {
    await db.collectorProfiles.sync(collectorStore.employeeId, {
      fullName: editForm.value.fullName.trim(),
      position: editForm.value.position.trim() || 'Сборщик'
    })
  } catch (error) {}

  // Закрываем модалку после сохранения
  showEditModal.value = false
}

async function handleLogout() {
  showLogoutModal.value = true
}

const showLogoutModal = ref(false)

async function confirmLogout() {
  showLogoutModal.value = false
  // Очищаем данные авторизации
  localStorage.removeItem('warehouse-brain-user')

  // Очистка интервала синхронизации
  if (window._appCleanup) window._appCleanup.syncInterval()

  // Выход из системы (очищаем локальные данные)
  try {
    await auth.signOut()
  } catch (e) {
    // Игнорируем ошибки
  }

  // Переход на страницу входа
  router.push('/login')
}

function formatLastScan(date) {
  if (!date) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const showClearModal = ref(false)
const showClearDbModal = ref(false)

async function clearAllData() {
  showClearModal.value = true
}

async function confirmClearAll() {
  showClearModal.value = false
  try {
    const boxResult = await boxesStore.clearAllBoxes()
    if (!boxResult.success) {
      window.showToast('❌ ' + (boxResult.error || 'Не удалось очистить короба'))
      return
    }
    const palletResult = await palletStore.clearAllPallets()
    if (!palletResult.success) {
      window.showToast('⚠️ ' + (palletResult.error || 'Не удалось очистить паллеты'))
      return
    }
    boxesStore.boxes = []
    boxesStore.currentBox = null
    palletStore.pallets = []
    palletStore.currentPallet = null
    palletStore.availableBoxes = []
    palletStore.availableSeparateItems = []
    window.showToast('Все данные очищены')
    loadStats()
  } catch (err) {
    window.showToast('❌ Ошибка: ' + err.message)
  }
}

async function clearBrainDatabase() {
  showClearDbModal.value = true
}

async function confirmClearBrainDatabase() {
  showClearDbModal.value = false
  try {
    const result = await brainStore.clearDatabase()
    if (result) {
      window.showToast('База данных очищена')
    } else {
      window.showToast('⚠️ Очистка отменена')
    }
  } catch (err) {
    window.showToast('❌ Ошибка: ' + err.message)
  }
}

// Вычисляемые инициалы
const initials = computed(() => {
  if (!fullName.value) return '??'
  const parts = fullName.value.trim().split(' ')
  if (parts.length >= 3) {
    return `${parts[0][0]}${parts[1][0]}${parts[2][0]}`.toUpperCase()
  } else if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  } else {
    return parts[0].slice(0, 2).toUpperCase()
  }
})
</script>

<template>
  <div class="user-page">
    <h1 class="page-title">Профиль</h1>

    <!-- Если не авторизован -->
    <div v-if="!isAuthenticated" class="not-authenticated-card">
      <div class="auth-icon">
        <svg class="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      </div>

      <h2 class="auth-title">Вход в систему</h2>
      <p class="auth-description">
        Войдите по табельному номеру, чтобы получить доступ к синхронизации данных и статистике
        работы
      </p>

      <ul class="auth-features">
        <li>
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          Синхронизация между устройствами
        </li>
        <li>
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          Сохранение истории сканирований
        </li>
        <li>
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          Статистика работы
        </li>
        <li>
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
          Работа с сервером
        </li>
      </ul>

      <Button class="login-button" @click="router.push('/login')">
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
          />
        </svg>
        Войти по табельному номеру
      </Button>
    </div>

    <!-- Если авторизован -->
    <template v-else>
      <!-- Декоративный бейджик -->
      <div class="badge-wrapper">
        <div class="id-badge">
          <div class="badge-header">
            <span class="badge-title">Карточка пользователя</span>
          </div>

          <div class="badge-photo-area">
            <img class="company-logo" src="/img/mvideo-1.svg" alt="logo company" width="150" />
          </div>

          <div class="badge-content">
            <div class="badge-name">{{ fullName || 'Не указано' }}</div>
            <div class="badge-position">{{ position || 'Должность не указана' }}</div>
            <div class="badge-id">
              <span class="id-label">Табельный номер</span>
              <span class="id-value">{{ employeeId || '—' }}</span>
            </div>
          </div>

          <div class="badge-footer">
            <div class="barcode"></div>
            <div class="badge-number">ID: {{ employeeId || '—' }}</div>
          </div>
        </div>
      </div>

      <!-- Карточка профиля -->
      <div class="profile-card">
        <div class="profile-info">
          <div class="info-row">
            <span class="label">Табельный номер</span>
            <span class="value">{{ employeeId || '—' }}</span>
          </div>

          <div class="info-row">
            <span class="label">ФИО</span>
            <span class="value">{{ fullName || '—' }}</span>
          </div>

          <div class="info-row">
            <span class="label">Должность</span>
            <span class="value">{{ position || '—' }}</span>
          </div>
        </div>

        <div class="profile-actions">
          <Button variant="secondary" class="action-btn" @click="openEditModal">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            Редактировать
          </Button>

          <Button variant="danger" class="action-btn" @click="handleLogout">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Выйти
          </Button>
        </div>
      </div>

      <!-- Переключатель режима тех.работ (только для админа) -->
      <div v-if="isUserAdmin" class="maintenance-toggle-card">
        <div class="maintenance-header">
          <div class="maintenance-icon-wrapper">
            <svg class="maintenance-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <div class="maintenance-title-wrapper">
            <h3 class="maintenance-title">Режим технических работ</h3>
            <p class="maintenance-description">При включении все пользователи увидят заглушку</p>
          </div>
        </div>

        <div class="maintenance-control">
          <button
            :class="['toggle-switch', maintenanceStore.isEnabled ? 'toggle-on' : 'toggle-off']"
            :disabled="maintenanceStore.isLoading"
            @click="maintenanceStore.toggleMaintenance()"
          >
            <span class="toggle-handle"></span>
          </button>
          <span :class="['toggle-status', maintenanceStore.isEnabled ? 'status-on' : 'status-off']">
            <template v-if="maintenanceStore.isLoading">
              <svg class="loading-spinner" fill="none" viewBox="0 0 24 24">
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Загрузка...
            </template>
            <template v-else>
              {{ maintenanceStore.isEnabled ? 'Включено' : 'Выключено' }}
            </template>
          </span>
        </div>

        <div
          v-if="maintenanceStore.isEnabled && !maintenanceStore.isLoading"
          class="maintenance-warning"
        >
          <svg class="warning-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>Сейчас все пользователи видят страницу "Ведутся технические работы"</span>
        </div>
      </div>

      <!-- Кнопки очистки для админа -->
      <div v-if="isUserAdmin" class="admin-clear-section">
        <div class="admin-clear-card">
          <div class="admin-clear-header">
            <div class="admin-clear-icon-wrapper">
              <svg class="admin-clear-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 11h8M8 15h6M12 3v4"
                />
              </svg>
            </div>
            <div class="admin-clear-title-wrapper">
              <h3 class="admin-clear-title">Очистка БД</h3>
              <p class="admin-clear-description">Удалить базу брака (товары)</p>
            </div>
          </div>
          <div class="admin-clear-control">
            <Button variant="danger" class="admin-clear-btn" @click="clearBrainDatabase">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Очистка БД
            </Button>
          </div>
        </div>

        <div class="admin-clear-card">
          <div class="admin-clear-header">
            <div class="admin-clear-icon-wrapper">
              <svg class="admin-clear-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
            <div class="admin-clear-title-wrapper">
              <h3 class="admin-clear-title">Паллеты и миксы</h3>
              <p class="admin-clear-description">Удалить паллеты, короба и товары</p>
            </div>
          </div>
          <div class="admin-clear-control">
            <Button variant="danger" class="admin-clear-btn" @click="clearAllData">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Очистить всё
            </Button>
          </div>
        </div>
      </div>

      <!-- Статистика -->
      <div class="stats-section">
        <h2 class="section-title">Статистика работы</h2>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon bg-green-500">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
            <div class="stat-info">
              <span class="stat-value">{{ stats.totalBoxes }}</span>
              <span class="stat-label">Собрано коробов</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon bg-purple-500">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
            </div>
            <div class="stat-info">
              <span class="stat-value">{{ stats.totalSeparateItems }}</span>
              <span class="stat-label">Отдельных товаров</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon bg-blue-500">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
            <div class="stat-info">
              <span class="stat-value">{{ stats.totalPallets }}</span>
              <span class="stat-label">Собрано паллетов</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Модальное окно редактирования -->
    <Modal
      v-model="showEditModal"
      title="Редактировать профиль"
      :show-cancel="false"
      @confirm="saveProfile"
    >
      <div class="edit-form">
        <div class="form-group">
          <label for="edit-fullname">ФИО</label>
          <Input
            id="edit-fullname"
            v-model="editForm.fullName"
            type="text"
            placeholder="Иванов Иван Иванович"
          />
        </div>

        <div class="form-group">
          <label for="edit-position">Должность</label>
          <Input id="edit-position" v-model="editForm.position" type="text" placeholder="Сборщик" />
        </div>
      </div>
    </Modal>

    <!-- Модальное окно выхода -->
    <Modal
      v-model="showLogoutModal"
      title="Выйти из аккаунта?"
      show-cancel
      confirm-text="Выйти"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmLogout"
    >
      <p class="text-slate-400 text-center">Все данные будут удалены с этого устройства</p>
    </Modal>

    <!-- Модальное окно очистки -->
    <Modal
      v-model="showClearModal"
      title="Очистка паллетов и миксов?"
      show-cancel
      confirm-text="Очистить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmClearAll"
    >
      <div class="text-left space-y-3 text-white">
        <p>Вы уверены, что хотите удалить все короба, паллеты и товары?</p>
        <div class="bg-slate-800/50 rounded-lg p-4">
          <p><strong>Будет удалено:</strong></p>
          <ul class="list-disc list-inside text-slate-300 mt-1">
            <li>Все короба (миксы)</li>
            <li>Все паллеты</li>
            <li>Все товары</li>
          </ul>
        </div>
        <p class="text-amber-400 text-sm text-center">Это действие нельзя отменить!</p>
      </div>
    </Modal>

    <!-- Модальное окно очистки БД -->
    <Modal
      v-model="showClearDbModal"
      title="Очистка базы брака?"
      show-cancel
      confirm-text="Очистить"
      cancel-text="Отмена"
      confirm-color="danger"
      @confirm="confirmClearBrainDatabase"
    >
      <div class="text-left space-y-3 text-white">
        <p>Вы уверены, что хотите очистить базу брака?</p>
        <div class="bg-slate-800/50 rounded-lg p-4">
          <p><strong>Будет удалено:</strong></p>
          <ul class="list-disc list-inside text-slate-300 mt-1">
            <li>Все товары из базы брака</li>
            <li>Локальный кэш</li>
          </ul>
        </div>
        <p class="text-amber-400 text-sm text-center">Это действие нельзя отменить!</p>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.user-page {
  padding: 1rem;
  padding-bottom: 140px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #f1f5f9;
  margin-bottom: 1.5rem;
}

/* Карточка для неавторизованных */
.not-authenticated-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 1rem;
  padding: 2rem 1.5rem;
  text-align: center;
  box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
}

.auth-icon {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  border: 3px solid rgba(255, 255, 255, 0.3);
}

.auth-icon svg {
  color: white;
}

.auth-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  margin-bottom: 0.75rem;
}

.auth-description {
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.95rem;
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.auth-features {
  list-style: none;
  padding: 0;
  margin: 0 0 1.5rem 0;
  text-align: left;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 0.75rem;
  padding: 1rem;
}

.auth-features li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: white;
  font-size: 0.95rem;
  padding: 0.5rem 0;
}

.auth-features li:not(:last-child) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.auth-features li svg {
  color: #4ade80;
  flex-shrink: 0;
}

.login-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: white;
  color: #667eea;
  font-weight: 600;
}

.login-button:hover {
  background: rgba(255, 255, 255, 0.9);
}

/* Декоративный бейджик */
.badge-wrapper {
  display: flex;
  justify-content: center;
  margin-bottom: 1.5rem;
}

.id-badge {
  width: 100%;
  /* max-width: 320px; */
  background: #ffffff;
  border-radius: 1rem;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
  border: 1px solid rgba(102, 126, 234, 0.3);
}

.badge-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 1rem;
  text-align: center;
}

.badge-title {
  color: white;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.badge-photo-area {
  background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
  padding: 1.25rem 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
  border-bottom: 2px solid #667eea;
}

.badge-content {
  padding: 1.25rem 1rem;
  text-align: center;
  background: #ffffff;
}

.badge-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 0.5rem;
  line-height: 1.3;
}

.badge-position {
  font-size: 0.875rem;
  color: #64748b;
  margin-bottom: 1rem;
  font-weight: 500;
}

.badge-id {
  background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  display: inline-block;
  min-width: 120px;
}

.id-label {
  display: block;
  font-size: 0.625rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}

.id-value {
  display: block;
  font-size: 1.125rem;
  font-weight: 700;
  color: #667eea;
  font-family: 'Courier New', monospace;
}

.badge-footer {
  background: #f8fafc;
  padding: 1rem;
  text-align: center;
  border-top: 1px solid #e2e8f0;
}

.barcode {
  height: 24px;
  margin: 0 auto 0.5rem;
  background: repeating-linear-gradient(
    90deg,
    #1e293b 0px,
    #1e293b 2px,
    transparent 2px,
    transparent 4px,
    #1e293b 4px,
    #1e293b 5px,
    transparent 5px,
    transparent 7px,
    #1e293b 7px,
    #1e293b 9px,
    transparent 9px,
    transparent 11px
  );
  width: 80%;
  max-width: 200px;
}

.badge-number {
  font-size: 0.625rem;
  color: #94a3b8;
  font-family: 'Courier New', monospace;
  letter-spacing: 0.1em;
}

/* Карточка профиля */
.profile-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 1rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
}

.profile-info {
  margin-bottom: 1.5rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.info-row:last-child {
  border-bottom: none;
}

.label {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.875rem;
}

.value {
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
}

.profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.action-btn {
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

/* Статистика */
.stats-section {
  margin-top: 2rem;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #f1f5f9;
  margin-bottom: 1rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.stat-card {
  background: #1e293b;
  border-radius: 0.75rem;
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid #334155;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-icon svg {
  color: white;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #f1f5f9;
}

.stat-label {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-top: 0.25rem;
}

/* Форма редактирования */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #e2e8f0;
}

/* Переключатель режима тех.работ */
.maintenance-toggle-card {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  border-radius: 1rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 10px 40px rgba(245, 158, 11, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.maintenance-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.maintenance-icon-wrapper {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.maintenance-icon {
  width: 28px;
  height: 28px;
  color: white;
}

.maintenance-title-wrapper {
  flex: 1;
}

.maintenance-title {
  font-size: 1rem;
  font-weight: 700;
  color: white;
  margin-bottom: 0.25rem;
}

.maintenance-description {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.3;
}

.maintenance-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
}

.toggle-switch {
  position: relative;
  width: 56px;
  height: 30px;
  border-radius: 15px;
  border: none;
  cursor: pointer;
  transition: background-color 0.3s ease;
  padding: 0;
  flex-shrink: 0;
}

.toggle-switch.toggle-on {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
}

.toggle-switch.toggle-off {
  background: rgba(255, 255, 255, 0.3);
}

.toggle-handle {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.3s ease;
}

.toggle-switch.toggle-on .toggle-handle {
  transform: translateX(26px);
}

.toggle-status {
  font-size: 0.9rem;
  font-weight: 600;
  margin-left: 1rem;
}

.toggle-status.status-on {
  color: #22c55e;
}

.toggle-status.status-off {
  color: rgba(255, 255, 255, 0.7);
}

.loading-spinner {
  width: 16px;
  height: 16px;
  display: inline-block;
  vertical-align: middle;
  margin-right: 6px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.opacity-25 {
  opacity: 0.25;
}

.opacity-75 {
  opacity: 0.75;
}

.maintenance-warning {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  margin-top: 1rem;
}

.warning-icon {
  width: 24px;
  height: 24px;
  color: #fbbf24;
  flex-shrink: 0;
}

.maintenance-warning span {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.4;
}

/* Карточка очистки для админа */
.admin-clear-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.admin-clear-card {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border-radius: 1rem;
  padding: 1.25rem;
  box-shadow: 0 10px 40px rgba(239, 68, 68, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.admin-clear-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.admin-clear-icon-wrapper {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.admin-clear-icon {
  width: 28px;
  height: 28px;
  color: white;
}

.admin-clear-title-wrapper {
  flex: 1;
}

.admin-clear-title {
  font-size: 1rem;
  font-weight: 700;
  color: white;
  margin-bottom: 0.25rem;
}

.admin-clear-description {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.3;
}

.admin-clear-control {
  display: flex;
  align-items: center;
  justify-content: center;
}

.admin-clear-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.3);
  color: white;
  border: 2px solid rgba(255, 255, 255, 0.3);
  font-weight: 600;
}

.admin-clear-btn:hover {
  background: rgba(0, 0, 0, 0.4);
  border-color: rgba(255, 255, 255, 0.5);
}
</style>
