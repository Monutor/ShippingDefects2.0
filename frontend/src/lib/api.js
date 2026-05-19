/**
 * HTTP-клиент для бэкенда Warehouse Brain.
 * Все запросы к /api/... идут на настроенный бэкенд.
 *
 * Переменные окружения:
 *   VITE_BACKEND_URL=http://localhost:3001        (dev)
 *   VITE_BACKEND_URL=https://your-domain.com      (prod)
 */

const API_BASE =
  import.meta.env.DEV
    ? ''
    : (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001')

/** Получить JWT-токен из localStorage */
function getToken() {
  try {
    const userStr = localStorage.getItem('warehouse-brain-user')
    if (!userStr) return null
    const user = JSON.parse(userStr)
    return user.token || null
  } catch (e) {
    try {
      localStorage.removeItem('warehouse-brain-user')
    } catch (cleanupErr) {
      console.error('[api] failed to clear corrupted user storage:', cleanupErr)
    }
    return null
  }
}

/** Создать headers с авторизацией */
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
  }
}

/* ============================================================
   Helper
============================================================ */

/** Выполнить fetch + вернуть JSON или бросить объект с code/status */
async function request(url, options = {}) {
  const fullUrl = `${API_BASE}${url}`

  const headers = { ...authHeaders() }
  if (!options.body) {
    delete headers['Content-Type']
  }

  const res = await fetch(fullUrl, {
    ...options,
    signal: options.signal,
    headers: { ...headers, ...(options.headers || {}) }
  })

  // Читаем body один раз — затем пробуем распарсить как JSON
  const rawText = await res.text()
  let data = null
  try {
    data = JSON.parse(rawText)
  } catch {
    // Response is not JSON — will be handled by !res.ok check below
  }

  if (!res.ok) {
    // Если 401 — токен истёк или невалидный: очищаем сессию и перенаправляем на login
    if (res.status === 401) {
      const userStr = localStorage.getItem('warehouse-brain-user')
      let tokenExpired = false
      if (userStr) {
        try {
          const user = JSON.parse(userStr)
          // Проверяем, не истёк ли токен (JWT expires in: 1d)
          if (user.authenticatedAt && user.token) {
            const expiredAt = new Date(user.authenticatedAt).getTime() + 1 * 24 * 60 * 60 * 1000
            tokenExpired = Date.now() > expiredAt
          } else {
            // Нет authenticatedAt или token — данные повреждены, очищаем
            tokenExpired = true
          }

          if (tokenExpired) {
            localStorage.removeItem('warehouse-brain-user')
          }
        } catch (navErr) {
          console.error('[api] failed to parse user session for 401 check:', navErr)
        }
      }

      // Перенаправляем на login только если токен истёк
      if (tokenExpired && !window._isNavigatingToLogin) {
        window._isNavigatingToLogin = true // P1 fix: мьютекс для навигации на login
        try {
          const module = await import('vue-router')
          if (typeof window.$router !== 'undefined' && typeof window.$router.push === 'function') {
            window.$router.push('/login')
          } else {
            window.location.href = '/login'
          }
        } catch {
        } finally {
          // Сброс мьютекса в любом случае — предотвращаем блокировку будущих 401 редиректов
          setTimeout(() => {
            window._isNavigatingToLogin = false
          }, 5000)
        }
      } else {
        // P1 fix: сброс мьютекса через 5 секунд после навигации
        setTimeout(() => {
          window._isNavigatingToLogin = false
        }, 5000)
      }

      // Если токен истёк — не продолжаем запрос, возвращаем ошибку auth
      if (tokenExpired) {
        return { error: { code: 401, message: 'Unauthorized', detail: 'Token expired' } }
      }
    }

    const errorText = data ? data?.error || data?.message || null : rawText || null
    return {
      error: {
        code: res.status,
        message: data?.error || data?.message || `HTTP ${res.status}`,
        detail: data || errorText
      }
    }
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

  /** Logout — clean local storage token */
  async signOut() {
    try {
      localStorage.removeItem('warehouse-brain-user')
    } catch (err) {
      console.error('[api] signOut: failed to clear localStorage:', err)
    }
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
    } catch {
      return null
    }
  }
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
    }
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
        const found = result.data.find((b) => b.id === boxId || b.box_id === boxId)
        return found
          ? { data: found, error: null }
          : { data: null, error: { message: 'Not found' } }
      }
      return result
    },
    async create(collectorId) {
      return request('/api/boxes', {
        method: 'POST',
        body: JSON.stringify({ collector_id: collectorId })
      })
    },
    async update(boxId, payload) {
      return request(`/api/boxes/${boxId}`, { method: 'PUT', body: JSON.stringify(payload) })
    },
    async delete(boxId) {
      return request(`/api/boxes/${boxId}`, { method: 'DELETE' })
    },
    async clearAllFinished({ active = false } = {}) {
      const qs = active ? '?active=true' : ''
      return request(`/api/boxes${qs}`, { method: 'DELETE' })
    }
  },

  /* ---- Box Items (товары внутри короба) ---- */
  boxItems: {
    async getByBoxId(boxId) {
      return request(`/api/boxes/${boxId}/items`)
    },
    addItem(boxId, itemData) {
      // BUG-4 fix: прямой метод для добавления товара в короб (используется flushPendingOfflineBoxItems)
      return request(`/api/boxes/${boxId}`, {
        method: 'PUT',
        body: JSON.stringify({ item: itemData })
      })
    },
    deleteItem(boxId, barcode) {
      return request(
        `/api/boxes/box-items?box_id=${boxId}&barcode=${encodeURIComponent(barcode)}`,
        { method: 'DELETE' }
      )
    }
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
    async deleteById(barcode) {
      return request(`/api/separate?barcode=${encodeURIComponent(barcode)}`, { method: 'DELETE' })
    },
    async clearAll() {
      return request('/api/separate', { method: 'DELETE' })
    }
  },

  /* ---- Collector Profiles (sync to backend) ---- */
  collectorProfiles: {
    /** Sync profile to backend after login/register */
    async sync(employeeId, data) {
      return request(`/api/auth/profile/${employeeId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      })
    }
  },

  /* ---- Scan History (batched) ---- */
  scanHistory: {
    /** Batch log scans */
    async logBatch(scans) {
      return request('/api/scan-history/batch', { method: 'POST', body: JSON.stringify({ scans }) })
    }
  },

  /* ---- Pallets ---- */
  pallets: {
    async getAll() {
      return request('/api/pallets')
    },
    async create(collectorId) {
      return request('/api/pallets', {
        method: 'POST',
        body: JSON.stringify({ collector_id: collectorId })
      })
    },
    async update(palletId, payload) {
      return request(`/api/pallets/${palletId}`, { method: 'PUT', body: JSON.stringify(payload) })
    },
    async delete(palletId) {
      return request(`/api/pallets/${palletId}`, { method: 'DELETE' })
    },
    async clearAll() {
      return request('/api/pallets/all', { method: 'DELETE' })
    }
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
        body: JSON.stringify(body)
      })
    },

    /** Добавить item в паллет (realtime sync) */
    async create(palletId, sourceType, sourceId) {
      return request(`/api/pallets/${palletId}/items`, {
        method: 'POST',
        body: JSON.stringify({ source_type: sourceType, source_id: sourceId })
      })
    },

    /** Удалить item из паллета */
    async delete(palletId, sourceType, sourceId) {
      // Используем query params для удаления конкретного товара по source_type и source_id
      return request(
        `/api/pallets/${palletId}/items?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}`,
        {
          method: 'DELETE'
        }
      )
    }
  }
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
  }
}

/* ============================================================
   WebSocket — realtime push (boxes_cleared, pallets_cleared)
============================================================ */

// WS URL выводится из VITE_BACKEND_URL — единый источник truth для API и WS
function buildWsUrl() {
  if (import.meta.env.DEV) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws/sync`
  }
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
  try {
    const url = new URL(backendUrl)
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${url.host}/ws/sync`
  } catch {
    return `ws://localhost:3001/ws/sync`
  }
}

const WS_URL = buildWsUrl()
let _socket = null
const _listeners = new Map() // eventName → Set<fn>
let _wsReconnectCount = 0 // L2 fix: счётчик для экспоненциального backoff
const WS_RECONNECT_BASE_MS = 1000 // 1 сек
const WS_RECONNECT_MAX_MS = 60000 // 60 сек
let _isConnecting = false // C5 fix: блокировка повторного connect
let _authFailed = false // P0 fix: блокируем reconnect при ошибке авторизации
let isDisconnecting = false // P2 fix: блокируем reconnect после logout

function _connectWithToken(token) {
  // Guard от duplicate connections и race conditions при быстром multiple вызове
  if (_socket && _socket.readyState === WebSocket.OPEN) return _socket
  if (_isConnecting || !token) return null
  _isConnecting = true

  try {
    const url = WS_URL // C2 fix: НЕ слать токен в URL — утечка через логи/proxy/history
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
            _authFailed = true // P0 fix: блокируем reconnect при ошибке auth
            _socket.close(4003, msg.message || 'Auth failed')
            return
          }

          if (!authReceived) return

          const fns = _listeners.get(msg.type) || []
          for (const fn of fns) fn(msg)
        } catch (err) {
          console.error('[api] ws: failed to process message:', err)
        }
      }
    }
    _socket.onerror = () => {
      _isConnecting = false
    }
    _socket.onclose = () => {
      _isConnecting = false
      // P0 fix: не reconnect при ошибке авторизации
      if (_authFailed) return

      const delayMs = Math.min(
        WS_RECONNECT_BASE_MS * Math.pow(2, _wsReconnectCount),
        WS_RECONNECT_MAX_MS
      )
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
    if (!token || isDisconnecting) return null // P2 fix: не reconnect после logout
    // Если сокет закрыт или нетокен — принудительно переподключаемся
    if (!_socket || _socket.readyState !== WebSocket.OPEN) {
      _wsReconnectCount = 0 // сбросим backoff при явном trigger
      return _connectWithToken(token)
    }
    return _socket
  },

  /** Отключить WebSocket */
  disconnect() {
    isDisconnecting = true // P2 fix: блокируем reconnect после logout
    if (_socket) {
      _socket.close()
      _socket = null
    }
  },

  /** Подписаться на событие (возвращает unsubscribe) */
  on(event, callback) {
    if (!_listeners.has(event)) _listeners.set(event, new Set())
    _listeners.get(event).add(callback)
    // Автоподключение при первой подписке
    this.connect()
    return () => {
      const fns = _listeners.get(event)
      if (fns) {
        fns.delete(callback)
        if (fns.size === 0) _listeners.delete(event)
      }
    }
  },

  /** Отписаться от события */
  off(event, callback) {
    const fns = _listeners.get(event)
    if (fns) {
      fns.delete(callback)
      if (fns.size === 0) _listeners.delete(event)
    }
  },

  /** Отправить сообщение на сервер */
  send(type, payload = {}) {
    if (!_socket || _socket.readyState !== WebSocket.OPEN) return false
    try {
      _socket.send(JSON.stringify({ type, ...payload }))
    } catch (err) {
      console.error('[api] ws: send failed:', err)
    }
    return true
  }
}

/* Default export */
export default { auth, db, maintenance, ws }

// Экспортируем request для прямого использования в stores
export { request }
