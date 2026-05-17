import { query, pool } from '../db/index.js';

/**
 * GET /api/brain — получить все элементы БД брака
 */
export default async function brainRoutes(app) {
  app.addHook('onRequest', async (request, reply) => {
    try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
  });

  app.get('/', async () => {
    const rows = await query('SELECT * FROM brain_items ORDER BY id');
    return rows;
  });

  /**
   * POST /api/brain/import — загрузить Excel файл с бракованными товарами
   * Парсер универсальный: сопоставление колонок через body params.
   */
  app.post('/import', {
    schema: {
      body: {
        type: 'object',
        required: ['rows'],
        properties: {
          columns: {
            type: 'object',
            description: 'Маппинг колонок Excel на поля БД. Все поля опциональны, по умолчанию авто-маппинг',
            properties: {
              barcode: { type: 'string' },
              name: { type: 'string' },
              brand: { type: 'string' },
              model: { type: 'string' },
              defect_type: { type: 'string' },
              comment: { type: 'string' },
            },
          },
          rows: {
            type: 'array',
            description: 'Массив строк из Excel файла',
            items: {
              type: 'object',
              properties: {
                barcode: { type: 'string' },
                name: { type: 'string' },
                brand: { type: 'string' },
                model: { type: 'string' },
                defect_type: { type: 'string' },
                comment: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Excel файл передаётся как multipart/form-data — Fastify не парсит это автоматически.
    // Для простоты: принимаем JSON с данными из уже распарсенного на фронте Excel.
    const { rows } = request.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return reply.code(400).send({ error: 'rows должен быть непустым массивом' });
    }

    // H6 fix: оборачиваем DELETE + INSERT в транзакцию — сбой после DELETE = пустая БД без восстановления
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM brain_items');

      let inserted = 0;
      for (const row of rows) {
        const barcode = String(row.barcode || '').trim();
        if (!barcode) continue; // пропускаем пустые строки

        await client.query(
          `INSERT INTO brain_items (barcode, name, brand, model, defect_type, comment, is_stop_item)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            barcode,
            row.name || null,
            row.brand || null,
            row.model || null,
            row.defect_type || null,
            row.comment || null,
            isStopItem(row.comment || '') ? true : false,
          ]
        );
        inserted++;
      }

      await client.query('COMMIT');
      return reply.send({ success: true, imported: inserted });
    } catch (err) {
      await client.query('ROLLBACK');
      app.log.error('Ошибка импорта brain_items (откат): ' + err.message);
      return reply.code(500).send({ error: 'Ошибка импорта данных. Попробуйте позже.' });
    } finally {
      client.release();
    }
  });

  /**
   * DELETE /api/brain — очистить всю БД брака (только админ)
   */
  app.delete('/', async (request, reply) => {
    // Проверка на админа через заголовок X-Admin или JWT role
    const is_admin = request.user?.is_admin || false;
    if (!is_admin) {
      return reply.code(403).send({ error: 'Только админ' });
    }

    await query('DELETE FROM brain_items');
    return reply.send({ success: true, deleted: 'all_brain_items' });
  });
}

/**
 * Проверка на стоп-товар по ключевым словам в комментарии.
 */
function isStopItem(comment) {
  const keywords = [
    'не согласован', 'бракуем', 'списать', 'запрет', 'stop',
    'brakem', 'writeoff', 'forbidden', 'reject'
  ];
  const lower = comment.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}
