import { query } from '../db/index.js';

/** GET /api/health */
export default async function healthRoutes(app) {
  app.get('/', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
}
