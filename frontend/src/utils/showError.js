/**
 * Показывает пользовательское сообщение об ошибке.
 * Фильтрует SQL-детали, stack traces и технические подробности.
 */
export function showError(rawMessage, fallback = 'Произошла ошибка. Попробуйте снова.') {
  if (!rawMessage) {
    window.showToast(fallback)
    return
  }

  const msg = String(rawMessage)

  // SQL-ошибки — не показываем детали
  if (/syntax error|relation|column|table|constraint|violat/i.test(msg)) {
    window.showToast(fallback)
    return
  }

  // Stack traces — обрезаем до первой строки
  if (msg.includes('\n') || msg.includes('at ')) {
    window.showToast(fallback)
    return
  }

  // Технические паттерны
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    window.showToast('Нет соединения с сервером')
    return
  }

  if (/fetch|network|request failed/i.test(msg)) {
    window.showToast('Ошибка сети. Проверьте подключение.')
    return
  }

  // Всё остальное — показываем как есть, но с префиксом
  window.showToast(`⚠️ ${msg}`)
}
