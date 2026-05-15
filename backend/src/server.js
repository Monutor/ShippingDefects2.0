/**
 * Сервер Fastify — HTTP API + SSE для realtime push.
 */

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config.js';
import { query } from './db/index.js';
import { initWebSocket } from './ws/index.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
});

// CORS через @fastify/cors — allowlist доверенных origins (не wildcard с credentials!)
await app.register(fastifyCors, {
  origin: [
    'http://localhost:3000',           // локальная разработка (Vite с прокси)
    'http://127.0.0.1:3000',
    'http://localhost:5173',           // Vite dev server (стандартный порт)
    'https://warehouse-brain.github.io', // GitHub Pages production
    'http://192.168.2.83:3000',        // локальный IP (ноутбук 1)
    'http://192.168.2.98:3000',        // локальный IP (ноутбук 2)
    ...((process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean)), // из .env для гибкости
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

app.decorate('authenticate', async (request, reply) => {
  try { await request.jwtVerify() }
  catch { return reply.unauthorized('Unauthorized', { code: 'unauthorized' }) }
});

// SSE endpoint — прямо на app ПЕРЕД registerRoutes
import { getSSE, updateMaintenance, broadcastSSE } from './routes/maintenance.js';
app.get('/api/maintenance', getSSE);
app.put('/api/maintenance', updateMaintenance);

// SSE для maintenance mode (отдельный endpoint)
app.get('/api/sync', getSSE);

// API остальные роуты
const { registerRoutes } = await import('./routes/index.js');
registerRoutes(app);

// WebSocket sync endpoint
initWebSocket(app);

// Запуск сервера
try {
  await app.listen({ host: config.server.host, port: config.server.port });
  console.log(`🚀 Backend: http://${config.server.host}:${config.server.port}`);
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}
