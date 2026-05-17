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

  // maintenance — публичный GET, PUT требует admin (регистрируется напрямую в server.js)

  // scan history — требует авторизации (hook внутри scan-history.js)
  app.register(import('./scan-history.js'), { prefix: '/api/scan-history' });

  // защищённые роуты — требуют JWT через hook
  app.register(import('./brain.js'), { prefix: '/api/brain' });
  app.register(import('./boxes.js'), { prefix: '/api/boxes' });
  app.register(import('./separate.js'), { prefix: '/api/separate' });
  app.register(import('./pallets.js'), { prefix: '/api/pallets' });
}
