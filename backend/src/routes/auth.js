import { query } from '../db/index.js';

// Простой rate limiter для login endpoint — защита от brute force
const loginAttempts = new Map() // employeeId → { count, firstAttempt }
const MAX_LOGIN_ATTEMPTS = 10
const LOCKOUT_MS = 5 * 60 * 1000 // 5 минут

function checkRateLimit(employeeId) {
  const now = Date.now()
  const attempt = loginAttempts.get(employeeId)

  if (!attempt) return true

  // Если прошло больше времени lockout — сбрасываем
  if (now - attempt.firstAttempt > LOCKOUT_MS) {
    loginAttempts.delete(employeeId)
    return true
  }

  // Если превысили лимит — блокируем
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    const remainingMs = LOCKOUT_MS - (now - attempt.firstAttempt)
    throw new Error(`Слишком много попыток. Подождите ${Math.ceil(remainingMs / 1000)} сек.`)
  }

  return true
}

function recordLoginAttempt(employeeId, success) {
  const now = Date.now()
  const attempt = loginAttempts.get(employeeId) || { count: 0, firstAttempt: now }

  if (success) {
    // Сбрасываем счётчик при успешном логине
    loginAttempts.delete(employeeId)
  } else {
    attempt.count++
    loginAttempts.set(employeeId, attempt)
  }
}

/** POST /api/auth/login — логин по employeeId */
export default async function authRoutes(app) {
  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['employeeId'],
        properties: {
          employeeId: { type: 'string' },
          fullName: { type: 'string' },
          position: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { employeeId, fullName, position } = request.body;

    // Rate limiting — защита от brute force / user enumeration
    try {
      checkRateLimit(employeeId)
    } catch (err) {
      return reply.code(429).send({ error: err.message })
    }

    // Step 1: проверяем, есть ли профиль в БД
    const profiles = await query(
      'SELECT * FROM collector_profiles WHERE employee_id = $1',
      [employeeId]
    );

    if (profiles.length > 0) {
      // Профиль существует — возвращаем его данные
      recordLoginAttempt(employeeId, true)
      return reply.send({
        token: app.jwt.sign({ 
          employeeId: profiles[0].employee_id, 
          is_admin: profiles[0].is_admin || false 
        }),
        profile: profiles[0],
        isNew: false,
      });
    }

    // Step 2: регистрация нового профиля
    if (!fullName || !position) {
      return reply.code(400).send({ error: 'Для регистрации нужны fullName и position' });
    }

    const result = await query(
      `INSERT INTO collector_profiles (employee_id, full_name, position, is_admin)
       VALUES ($1, $2, $3, false)
       RETURNING *`,
      [employeeId, fullName, position]
    );

    recordLoginAttempt(employeeId, true)

    return reply.send({
      token: app.jwt.sign({ 
        employeeId: result[0].employee_id, 
        is_admin: false 
      }),
      profile: result[0],
      isNew: true,
    });
  });

  /** GET /api/auth/me — получить текущего пользователя (JWT required) */
  app.get('/me', async (request, reply) => {
    // JWT guard: должен быть уже верифицирован onRequest hook или здесь
    if (!request.user || !request.user.employeeId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { employeeId } = request.user;
    const profiles = await query(
      'SELECT * FROM collector_profiles WHERE employee_id = $1',
      [employeeId]
    );

    if (profiles.length === 0) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    const is_admin = profiles[0].is_admin || false;
    return { ...profiles[0], is_admin };
  });
}
