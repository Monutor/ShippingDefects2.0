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
