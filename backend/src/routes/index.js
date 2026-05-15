/**
 * Регистрация всех API роутов.
 */

export function registerRoutes(app) {
  // health check — не требует авторизации
  app.register(import('./health.js'));

  // auth — публичный, не требует middleware
  app.register(import('./auth.js'), { prefix: '/api/auth' });

  // profile — GET публичный, PUT требует авторизации (проверка в самом route)
  app.register(import('./profile.js'), { prefix: '/api/auth/profile' });

  // maintenance — публичный GET, PUT требует admin
  app.register(import('./maintenance.js'), { prefix: '/api/maintenance' });

  // scan history — требует авторизации
  app.register(import('./scan-history.js'), { prefix: '/api/scan-history' }, {
    preHandler: async (request, reply) => {
      try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
    },
  });

  // защищённые роуты — требуют JWT через hook
  app.register(import('./brain.js'), { prefix: '/api/brain' });
  app.register(import('./boxes.js'), { prefix: '/api/boxes' });
  app.register(import('./separate.js'), { prefix: '/api/separate' });
  app.register(import('./pallets.js'), { prefix: '/api/pallets' });

  // health check для всего API
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}
