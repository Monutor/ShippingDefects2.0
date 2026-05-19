/**
 * Сервер Fastify — HTTP API + SSE для realtime push.
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config.js';
import { initWebSocket } from './ws/index.js';
import { pool } from './db/index.js';


const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
});

// CORS через @fastify/cors — allowlist доверенных origins (не wildcard с credentials!)
const isDev = process.env.NODE_ENV !== 'production' || process.env.BACKEND_SSL === 'false';
await app.register(fastifyCors, {
  origin: isDev
    ? true // В dev-режиме разрешаем все origins (localhost, IP, телефон, ТСД)
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'https://monutor.github.io',
        'https://warehouse-brain-backend.onrender.com',
        ...((process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean)),
      ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// JWT ДО роутов
await app.register(fastifyJwt, {
  secret: config.jwt.secret,
  sign: { expiresIn: config.jwt.expiresIn },
});

// WebSocket ДО роутов
await app.register(fastifyWebsocket);

// ============================================================
// Rate limiting — защита от спама и DoS (in-memory, без зависимостей)
// ============================================================
const rateLimitStore = new Map();

/**
 * Проверяет rate limit для IP.
 * Возвращает { allowed, remaining, reset, limit } или null если лимит превышен.
 */
function checkRateLimit(ip, max, windowMs) {
  const now = Date.now();
  const key = `${ip}:${max}`;
  let entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, windowStart: now };
    rateLimitStore.set(key, entry);
  }

  entry.count++;
  const remaining = Math.max(0, max - entry.count);
  const reset = Math.ceil((entry.windowStart + windowMs - now) / 1000);

  if (entry.count > max) {
    return null; // лимит превышен
  }

  return { allowed: true, remaining, reset, limit: max };
}

// Очистка старых записей каждые 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > 5 * 60 * 1000) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Hook: rate limit для всех /api/* запросов
app.addHook('onRequest', async (request, reply) => {
  const url = request.url;
  const method = request.method;
  const ip = request.ip;

  // Пропускаем health check и SSE
  if (url.startsWith('/api/health') || url.startsWith('/api/sync') || url.startsWith('/api/maintenance')) {
    return;
  }

  // GET: 100 запросов в минуту
  if (method === 'GET') {
    const result = checkRateLimit(ip, 100, 60 * 1000);
    if (result) {
      reply.header('x-ratelimit-limit', result.limit);
      reply.header('x-ratelimit-remaining', result.remaining);
      reply.header('x-ratelimit-reset', result.reset);
    } else {
      reply.header('retry-after', Math.ceil(60 - (Date.now() - rateLimitStore.get(`${ip}:100`)?.windowStart || 0) / 1000));
      return reply.code(429).send({ error: 'Слишком много запросов. Попробуйте через минуту.' });
    }
  }

  // POST/PUT/DELETE: 30 запросов в минуту (write-эндпоинты)
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const result = checkRateLimit(ip, 30, 60 * 1000);
    if (result) {
      reply.header('x-ratelimit-limit', result.limit);
      reply.header('x-ratelimit-remaining', result.remaining);
      reply.header('x-ratelimit-reset', result.reset);
    } else {
      reply.header('retry-after', 60);
      return reply.code(429).send({ error: 'Слишком много запросов на запись. Попробуйте через минуту.' });
    }
  }
});

// SSE endpoint — maintenance mode + sync
import { getSSE, updateMaintenance } from './routes/maintenance.js';
app.get('/api/maintenance', getSSE);
app.put('/api/maintenance', updateMaintenance);
app.get('/api/sync', getSSE);

// API остальные роуты
const { registerRoutes } = await import('./routes/index.js');
registerRoutes(app);

// WebSocket sync endpoint
initWebSocket(app);

// -�����?�� ??��???��
try {
  await app.listen({ host: config.server.host, port: config.server.port });
  app.log.info(`🚀 Backend: http://${config.server.host}:${config.server.port}`);
} catch (err) {
  app.log.error('Failed to start server: ' + err.message);
  process.exit(1);
}

// Graceful shutdown — закрываем DB pool и Fastify при SIGTERM/SIGINT
async function gracefulShutdown(signal) {
  app.log.info(`\n📡 ${signal} received — shutting down gracefully...`);
  try {
    await app.close();
    await pool.end();
    app.log.info('✅ Shutdown complete');
    process.exit(0);
  } catch (err) {
    app.log.error('❌ Error during shutdown: ' + err.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
