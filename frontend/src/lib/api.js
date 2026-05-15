/**
 * HTTP-клиент для бэкенда Warehouse Brain.
 * Все запросы к /api/... идут на настроенный бэкенд.
 *
 * Переменные окружения:
 *   VITE_BACKEND_URL=http://localhost:3001        (dev)
 *   VITE_BACKEND_URL=https://your-domain.com      (prod)
 */

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

/** Получить JWT-токен из localStorage */
function getToken() {
  try {
    const userStr = localStorage.getItem('warehouse-brain-user')
    if (!userStr) return null
    const user = JSON.parse(userStr)
    return user.token || null
  } catch (e) {
    // L2 fix: повреждённый JSON — предупреждаем и очищаем сессию
    console.warn('⚠️ warehouse-brain-user: повреждённый JSON, очищаю сессию', e.message)
    try { localStorage.removeItem('warehouse-brain-user') } catch {}
    return null
  }
}

/** Создать headers с авторизацией */
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
  }
}

/* ============================================================
   Helper
============================================================ */

/** Выполнить fetch + вернуть JSON или бросить объект с code/status */
async function request(url, options = {}) {
  const fullUrl = `${API_BASE}${url}`

  const res = await fetch(fullUrl, {
    ...options,
    signal: options.signal,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    // Если 401 — токен истёк или невалидный: очищаем сессию и перенаправляем на login
    if (res.status === 401) {
      const userStr = localStorage.getItem('warehouse-brain-user')
      let tokenExpired = false
      if (userStr) {
        try {
          const user = JSON.parse(userStr)
          // Проверяем, не истёк ли токен (JWT expires in: 7d)
          if (user.authenticatedAt && user.token) {
            const expiredAt = new Date(user.authenticatedAt).getTime() + 7 * 24 * 60 * 60 * 1000
            tokenExpired = Date.now() > expiredAt
          } else {
            // Нет authenticatedAt или token — данные повреждены, очищаем
            tokenExpired = true
          }

          if (tokenExpired) {
            localStorage.removeItem('warehouse-brain-user')
          }
        } catch {}
      }

      // Перенаправляем на login только если токен истёк
      if (tokenExpired && !window._isNavigatingToLogin) {
        window._isNavigatingToLogin = true  // P1 fix: мьютекс для навигации на login
        try {
          // FIX: useRouter() нельзя вызывать вне контекста компонента — используем window.location.href
          // Динамический import + router.push как fallback (работает только из <script setup>)
          const module = await import('vue-router')
          // eslint-disable-next-line no-undef
          if (typeof window.$router !== 'undefined' && typeof window.$router.push === 'function') {
            window.$router.push('/login')
          } else {
            window.location.href = '/login'
          }

        } catch {}
      } else {
        // P1 fix: сброс мьютекса через 5 секунд после навигации
        setTimeout(() => { window._isNavigatingToLogin = false }, 5000)
      }

      // Если токен истёк — не продолжаем запрос, возвращаем ошибку auth
      if (tokenExpired) {
        return { error: { code: 401, message: 'Unauthorized', detail: 'Token expired' } }
      }
    }

    const errorText = data ? (data?.error || data?.message || null) : await res.text().catch(() => null)
    return { error: { code: res.status, message: data?.error || data?.message || `HTTP ${res.status}`, detail: data || errorText } }
  }

  return { data, error: null }
}

/* ============================================================
   Auth module — авторизация и логин
============================================================ */
export const auth = {
  /** Login / register by employeeId */
  async login(employeeId, fullName, position) {
    const body = { employeeId }
    if (fullName) body.fullName = fullName
    if (position) body.position = position
    return request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) })
  },

  /** Get current user profile */
  async getMe() {
    return request('/api/auth/me')
  },

  /** Logout — clean local storage token */
  logout() {
    try {
      const userStr = localStorage.getItem('warehouse-brain-user')
      if (userStr) {
        const user = JSON.parse(userStr)
        delete user.token
        // L4 fix: если token не был установлен или равен null — удаляем весь ключ
        if (!user.token || user.token === 'null') {
          localStorage.removeItem('warehouse-brain-user')
        } else {
          localStorage.setItem('warehouse-brain-user', JSON.stringify(user))
        }
      }
    } catch {}
  },

  /** Logout — clean local storage token */
  async signOut() {
    this.logout()
    localStorage.removeItem('warehouse-brain-user')
  },

  /** Check if authenticated */
  isAuthenticated() {
    return !!getToken()
  },

  /** Get employeeId of current user */
  getUserId() {
    try {
      const userStr = localStorage.getItem('warehouse-brain-user')
      if (!userStr) return null
      const user = JSON.parse(userStr)
      return user.employeeId || user.id || null
    } catch { return null }
  },

  /** Check online status */
  isOnline() {
    return navigator.onLine
  },
}

/* ============================================================
   DB module — работа с данными
============================================================ */
export const db = {
  /* ---- Brain Items ---- */
  brainItems: {
    async getAll() {
      return request('/api/brain')
    },
    async import({ rows }) {
      return request('/api/brain/import', { method: 'POST', body: JSON.stringify({ rows }) })
    },
    async clearAll() {
      return request('/api/brain', { method: 'DELETE' })
    },
  },

  /* ---- Boxes ---- */
  boxes: {
    async getAll() {
      return request('/api/boxes')
    },
    async getById(boxId) {
      const result = await request(`/api/boxes/${boxId}`)
      // GET /api/boxes возвращает массив — берём первый элемент с нужным ID
      if (result?.data && Array.isArray(result.data)) {
        const found = result.data.find(b => b.id === boxId || b.box_id === boxId)
        return found ? { data: found, error: null } : { data: null, error: { message: 'Not found' } }
      }
      return result
    },
    async create(collectorId) {
      return request('/api/boxes', { method: 'POST', body: JSON.stringify({ collector_id: collectorId }) })
    },
    async update(boxId, payload) {
      return request(`/api/boxes/${boxId}`, { method: 'PUT', body: JSON.stringify(payload) })
    },
    async delete(boxId) {
      return request(`/api/boxes/${boxId}`, { method: 'DELETE' })
    },
    async clearAllFinished() {
      return request('/api/boxes?status=finished', { method: 'DELETE' })
    },
  },

  /* ---- Box Items (товары внутри короба) ---- */
  boxItems: {
    async getByBoxId(boxId) {
      return request(`/api/boxes/${boxId}/items`)
    },
    addItem(boxId, itemData) {
      // BUG-4 fix: прямой метод для добавления товара в короб (используется flushPendingOfflineBoxItems)
      return request(`/api/boxes/${boxId}`, { method: 'PUT', body: JSON.stringify({ item: itemData }) })
    },
    deleteItem(boxId, barcode) {
      return request(`/api/boxes/box-items?box_id=${boxId}&barcode=${encodeURIComponent(barcode)}`, { method: 'DELETE' })
    },
  },

  /* ---- Separate Items (независимые товары) ---- */
  separateItems: {
    async getAll() {
      return request('/api/separate')
    },
    async add(item, options = {}) {
      const body = { item }
      if (options.containerId) body.containerId = options.containerId
      if (options.containerType) body.containerType = options.containerType
      return request('/api/separate', { method: 'POST', body: JSON.stringify(body) })
    },
    async deleteById(itemId) {
      return request(`/api/separate/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
    },
    async clearAll() {
      return request('/api/separate', { method: 'DELETE' })
    },
    /** Получить separate items для контейнера */
    async getByContainer(containerId, containerType) {
      return request(`/api/separate/by-container/${containerId}?type=${containerType}`)
    },
  },

  /* ---- Collector Profiles (sync to backend) ---- */
  collectorProfiles: {
    /** Sync profile to backend after login/register */
    async sync(employeeId, data) {
      return request(`/api/auth/profile/${employeeId}`, { method: 'PUT', body: JSON.stringify(data) })
    },
  },

  /* ---- Scan History (batched) ---- */
  scanHistory: {
    /** Batch log scans */
    async logBatch(scans) {
      return request('/api/scan-history/batch', { method: 'POST', body: JSON.stringify({ scans }) })
    },
    /** Get last scan timestamp for a barcode */
    async getLastScan(barcode) {
      return request(`/api/scan-history/last-scan?barcode=${encodeURIComponent(barcode)}`)
    },
  },

  /* ---- Pallets ---- */
  pallets: {
    async getAll() {
      return request('/api/pallets')
    },
    async create(collectorId) {
      return request('/api/pallets', { method: 'POST', body: JSON.stringify({ collector_id: collectorId }) })
    },
    async update(palletId, payload) {
      return request(`/api/pallets/${palletId}`, { method: 'PUT', body: JSON.stringify(payload) })
    },
    async delete(palletId) {
      return request(`/api/pallets/${palletId}`, { method: 'DELETE' })
    },
    async cancel(palletId) {
      // BUG-20 fix: Content-Type должен быть application/json т.к. body — JSON.stringify({})
      return request(`/api/pallets/${palletId}/cancel`, { method: 'PATCH', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } })
    },
    async clearAllFinished() {
      return request('/api/pallets', { method: 'DELETE' })
    },
    async clearAll() {
      return request('/api/pallets/all', { method: 'DELETE' })
    },
  },

  /* ---- Pallet Items (содержимое паллета) ---- */
  palletItems: {
    async getByPalletId(palletId) {
      return request(`/api/pallets/${palletId}/items`)
    },
    /** Добавить товар в паллет */
    async addInline(palletId, itemData) {
      // Unified schema: передаём source_type='inline' для pallet_items
      const body = {
        source_type: itemData.source_type || 'inline',
        source_id: itemData.number || '',
        name: itemData.name || '',
        article: itemData.article || '',
        comment: itemData.comment || '',
        scanned_at: itemData.scannedAt || null
      }
      return request(`/api/pallets/${palletId}/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },

    /** Добавить item в паллет (realtime sync) */
    async create(palletId, sourceType, sourceId) {
      return request(`/api/pallets/${palletId}/items`, {
        method: 'POST',
        body: JSON.stringify({ source_type: sourceType, source_id: sourceId }),
      })
    },

    /** Удалить item из паллета */
    async delete(palletId, sourceType, sourceId) {
      // Используем query params для удаления конкретного товара по source_type и source_id
      return request(`/api/pallets/${palletId}/items?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}`, {
        method: 'DELETE',
      })
    },
  },
}

/* ============================================================
   Maintenance settings (управление режимом тех.работ)
============================================================ */
export const maintenance = {
  /** Load current setting from backend */
  async load(signal) {
    return request('/api/maintenance', signal ? { signal } : {})
  },

  /** Save toggle to backend */
  save(isEnabled) {
    return request('/api/maintenance', { method: 'PUT', body: JSON.stringify({ isEnabled }) })
  },
}

/* ============================================================
   WebSocket — realtime push (boxes_cleared, pallets_cleared)
============================================================ */

const WS_URL = `${window.location.protocol === 'https:' ? 'wss://' : 'ws://'}${import.meta.env.VITE_BACKEND_HOST || 'localhost:3001'}/ws/sync`
let _socket = null
const _listeners = new Map() // eventName → Set<fn>
let _wsReconnectCount = 0  // L2 fix: счётчик для экспоненциального backoff
const WS_RECONNECT_BASE_MS = 1000   // 1 сек
const WS_RECONNECT_MAX_MS = 60000   // 60 сек
let _isConnecting = false            // C5 fix: блокировка повторного connect
let _authFailed = false              // P0 fix: блокируем reconnect при ошибке авторизации
let isDisconnecting = false          // P2 fix: блокируем reconnect после logout

function _connectWithToken(token) {
  // Guard от duplicate connections и race conditions при быстром multiple вызове
  if (_socket && _socket.readyState === WebSocket.OPEN) return _socket
  if (_isConnecting || !token) return null
  _isConnecting = true
  
  try {
    const url = WS_URL  // C2 fix: НЕ слать токен в URL — утечка через логи/proxy/history
    _socket = new WebSocket(url)

    let authReceived = false
    _socket.onopen = () => {
      // Отправляем JWT через handshake message вместо URL param
      _isConnecting = false
      _socket.send(JSON.stringify({ type: 'auth', token }))

      _socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'auth_result' && msg.success) {
            _wsReconnectCount = 0
            authReceived = true
            _socket.send(JSON.stringify({ type: 'init_request' }))
            return
          } else if (msg.type === 'auth_result' && !msg.success) {
            _authFailed = true  // P0 fix: блокируем reconnect при ошибке auth
            _socket.close(4003, msg.message || 'Auth failed')
            return
          }

          if (!authReceived) return

          const fns = _listeners.get(msg.type) || []
          for (const fn of fns) fn(msg)
        } catch {}
      }
    }
    _socket.onerror = () => { _isConnecting = false }
    _socket.onclose = () => {
      _isConnecting = false
      // P0 fix: не reconnect при ошибке авторизации
      if (_authFailed) return

      const delayMs = Math.min(WS_RECONNECT_BASE_MS * Math.pow(2, _wsReconnectCount), WS_RECONNECT_MAX_MS)
      setTimeout(() => {
        const t = getToken()
        if (t) _connectWithToken(t)
      }, delayMs)
    }
    return _socket
  } catch {
    // FIX: сбрасываем флаг чтобы не заблокировать WS навсегда при ошибке new WebSocket()
    _isConnecting = false
    return null
  }
}

export const ws = {
  connect() {
    const token = getToken()
    if (!token) return null
    return _connectWithToken(token)
  },

  /** BUG-9 fix: reconnect — если WS был подключён но упал при logout/login, переподключится при новом login */
  triggerReconnect() {
    const token = getToken()
    if (!token || isDisconnecting) return null  // P2 fix: не reconnect после logout
    // Если сокет закрыт или нетокен — принудительно переподключаемся
    if (!_socket || _socket.readyState !== WebSocket.OPEN) {
      _wsReconnectCount = 0  // сбросим backoff при явном trigger
      return _connectWithToken(token)
    }
    return _socket
  },

  /** Отключить WebSocket */
  disconnect() {
    isDisconnecting = true  // P2 fix: блокируем reconnect после logout
    if (_socket) { _socket.close(); _socket = null }
  },

  /** Подписаться на событие (возвращает unsubscribe) */
  on(event, callback) {
    if (!_listeners.has(event)) _listeners.set(event, new Set())
    _listeners.get(event).add(callback)
    // Автоподключение при первой подписке
    this.connect()
    return () => {
      const fns = _listeners.get(event)
      if (fns) { fns.delete(callback); if (fns.size === 0) _listeners.delete(event) }
    }
  },

  /** Отписаться от события */
  off(event, callback) {
    const fns = _listeners.get(event)
    if (fns) { fns.delete(callback); if (fns.size === 0) _listeners.delete(event) }
  },

  /** Отправить сообщение на сервер */
  send(type, payload = {}) {
    if (!_socket || _socket.readyState !== WebSocket.OPEN) return false
    try { _socket.send(JSON.stringify({ type, ...payload })) } catch {}
    return true
  },

  /** Статус подключения */
  isConnected() {
    return _socket && _socket.readyState === WebSocket.OPEN
  },

  /** Подписаться на конкретный короб */
  subscribeBox(boxId) {
    this.send('subscribe', { boxId })
  },
}

/* Default export */
export default { auth, db, maintenance, ws }

// Экспортируем request для прямого использования в stores
export { request }
