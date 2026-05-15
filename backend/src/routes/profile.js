import { query } from '../db/index.js';

/**
 * GET /api/auth/profile/:employeeId — получить профиль по табельному номеру
 * PUT /api/auth/profile/:employeeId — обновить профиль
 */
export default async function profileRoutes(app) {
  /** Получить профиль (JWT required) */
  app.get('/:employeeId', async (request, reply) => {
    // JWT guard: только авторизованные пользователи могут получать профили
    try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }

    const profiles = await query(
      'SELECT * FROM collector_profiles WHERE employee_id = $1',
      [request.params.employeeId]
    );

    if (profiles.length === 0) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    return profiles[0];
  });

  /** Обновить профиль */
  app.put('/:employeeId', async (request, reply) => {
    // Проверка JWT
    try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }

    // Только свой профиль или админ
    if (request.user.employeeId !== request.params.employeeId && !request.user.is_admin) {
      return reply.code(403).send({ error: 'Можно обновлять только свой профиль' });
    }

    const { fullName, position } = request.body;

    await query(
      `UPDATE collector_profiles SET full_name = $1, position = $2, updated_at = NOW() WHERE employee_id = $3`,
      [fullName, position, request.params.employeeId]
    );

    return reply.send({ success: true });
  });
}
