import { query } from '../db/index.js';

/** SSE subscribers (client_id → res) */
const sseSubscribers = new Map()
let subscriberId = 0

export function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const deadSubscribers = []
  for (const [id, res] of sseSubscribers) {
    if (!res.writable) {
      deadSubscribers.push(id);
      continue;
    }
    try { res.write(payload) } catch {
      deadSubscribers.push(id);
    }
  }
  // Удаляем мёртвых подписчиков
  for (const id of deadSubscribers) {
    sseSubscribers.delete(id);
  }
}

/** SSE GET handler — stream maintenance mode updates */
export async function getSSE(request, reply) {
  const origin = request.headers.origin || ''

  // CORS для SSE — @fastify/cors не доносит заголовки на streaming-ответы
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  })

  const id = ++subscriberId
  sseSubscribers.set(id, reply.raw)

  // Текущее maintenance mode
  try {
    const settings = await query("SELECT value FROM app_settings WHERE key = 'maintenance_mode' LIMIT 1")
    const enabled = settings.length > 0 ? settings[0].value === 'true' : false
    reply.raw.write(`event: init\ndata: ${JSON.stringify({ maintenanceMode: enabled })}\n\n`)
  } catch {
    reply.raw.write('event: init\ndata: {"maintenanceMode":false}\n\n')
  }

  // Heartbeat каждые 15 сек
  const heartbeat = setInterval(() => {
    try { reply.raw.write(': heartbeat\n\n') } catch {}
  }, 15000)

  request.raw.on('close', () => {
    clearInterval(heartbeat)
    sseSubscribers.delete(id)
  })
  request.raw.on('error', () => {
    clearInterval(heartbeat)
    sseSubscribers.delete(id)
  })
}

/** Обновить maintenance mode */
export async function updateMaintenance(request, reply) {
  try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
  if (!request.user?.is_admin) return reply.code(403).send({ error: 'Только администратор может включать maintenance mode' })

  const newValue = Boolean(request.body.isEnabled) ? 'true' : 'false'

  await query(
    `INSERT INTO app_settings (key, value) VALUES ('maintenance_mode', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [newValue]
  )

  // Broadcast всем SSE клиентам
  broadcastSSE('maintenance_mode_changed', { enabled: newValue === 'true' })

  return reply.send({ success: true, maintenance_mode: newValue === 'true' })
}

/** Маршруты — регистрируются ТОЛЬКО через registerRoutes в server.js */
export default async function maintenanceRoutes(app) {
  // ПУСТО — маршруты уже добавлены напрямую на app в server.js
}
