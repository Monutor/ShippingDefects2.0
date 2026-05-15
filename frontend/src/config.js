/**
 * Проверка прав администратора
 * Берёт is_admin из JWT payload (сохранён в localStorage при логине)
 * fallback на хардкод для обратной совместимости
 */
export function isAdmin() {
  const userData = localStorage.getItem('warehouse-brain-user')
  if (!userData) return false

  try {
    const user = JSON.parse(userData)
    // Сначала проверяем JWT is_admin, потом fallback на табельный номер
    return !!user.is_admin || user.employeeId === '181165'
  } catch {
    return false
  }
}
