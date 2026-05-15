<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

function goToLogin() {
  router.push('/login')
}
</script>

<template>
  <div class="maintenance-container">
    <div class="maintenance-content">
      <!-- Иконка с анимацией -->
      <div class="maintenance-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>

      <!-- Заголовок -->
      <h1 class="title">Ведутся технические работы</h1>

      <!-- Описание -->
      <p class="description">
        Приносим извинения за неудобства.<br />
        Скоро мы вернемся с обновлениями!
      </p>

      <!-- Кнопка входа -->
      <button
        @click="goToLogin"
        class="login-btn"
      >
        Войти в профиль
      </button>
    </div>
  </div>
</template>

<style scoped>
.maintenance-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.maintenance-content {
  text-align: center;
  color: white;
  max-width: 400px;
}

.maintenance-icon {
  margin-bottom: 32px;
  animation: pulse 2s ease-in-out infinite;
}

.maintenance-icon .icon {
  width: 96px;
  height: 96px;
  opacity: 0.9;
}

.title {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 16px;
  line-height: 1.3;
}

.description {
  font-size: 16px;
  opacity: 0.9;
  line-height: 1.6;
  margin-bottom: 32px;
}

.login-btn {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.login-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.5);
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
  }
}
</style>
