import { query, pool } from '../db/index.js';

/**
 * GET /api/scan-history — история сканирований с пагинацией
 * POST /api/scan-history/batch — пакетная отправка сканов
 */
export default async function scanHistoryRoutes(app) {
  // GET /api/scan-history
  app.get('/', async (request, reply) => {
    const { collector_id, limit = '10', offset = '0' } = request.query;

    let whereClauses = [];
    const params = [];
    let paramIndex = 1;

    if (collector_id) {
      whereClauses.push(`collector_id = $${paramIndex}`);
      params.push(collector_id);
      paramIndex++;
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Общий count для пагинации
    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM scan_history ${whereSQL}`,
      params
    );
    const total = countResult[0]?.total ?? 0;

    // FIX: используем параметризованные запросы для LIMIT/OFFSET вместо строковой конкатенации
    // PostgreSQL v8+ поддерживает $N параметры в LIMIT и OFFSET
    const limitVal = Math.max(1, parseInt(limit, 10)) || 10;
    const offsetVal = Math.max(0, parseInt(offset, 10)) || 0;

    // Параметры: WHERE params + LIMIT + OFFSET (всегда последние)
    const dataParams = [...params, limitVal, offsetVal];
    // Индекс для LIMIT/OFFSET — всегда после всех WHERE параметров
    const limitOffsetIndex = paramIndex + params.length;

    const items = await query(
      `SELECT * FROM scan_history ${whereSQL}
       ORDER BY created_at DESC
       LIMIT $${limitOffsetIndex} OFFSET $${limitOffsetIndex + 1}`,
      dataParams
    );

    return reply.send({ items, total });
  });

  // POST /api/scan-history/batch — пакетная отправка сканов
  app.post('/batch', async (request, reply) => {
    const { scans } = request.body;

    if (!Array.isArray(scans) || scans.length === 0) {
      return reply.code(400).send({ error: 'scans должен быть непустым массивом' });
    }

    // FIX: оборачиваем batch insert в транзакцию для атомарности
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let insertedCount = 0;
      for (const scan of scans) {
        // M5 fix: валидация barcode — не допускаем null/undefined
        if (!scan.barcode || typeof scan.barcode !== 'string') {
          console.warn('⚠️ Пропускаю скан без barcode:', scan)
          continue
        }

        const result = await client.query(
          `INSERT INTO scan_history (collector_id, barcode, matched, in_box, box_status, batch_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            scan.collector_id || null,
            scan.barcode.trim(),  // M5 fix: trim для безопасности
            false, // matched по умолчанию false
            scan.box_id || null, // in_box — UUID короба
            scan.action || 'scan', // action_type: 'scan' | 'added' | 'finished'
            scan.batch_id || `batch-${Date.now()}`,
          ]
        );

        if (result?.rowCount) insertedCount++;
      }

      await client.query('COMMIT');
      return reply.send({ success: true, inserted: insertedCount });
    } catch (err) {
      await client.query('ROLLBACK');
      app.log.error('❌ scan-history batch insert error:', err);
      return reply.code(500).send({ error: 'Failed to insert scan batch' });
    } finally {
      client.release();
    }
  });

  // GET /api/scan-history/last-scan — последний скан для barcode
  app.get('/last-scan', async (request, reply) => {
    const { barcode } = request.query;

    if (!barcode || typeof barcode !== 'string') {
      return reply.code(400).send({ error: 'barcode обязателен' });
    }

    // Получаем последний скан для данного barcode (любой collector)
    const result = await query(
      `SELECT created_at FROM scan_history 
       WHERE barcode = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [barcode]
    );

    if (!result || result.length === 0) {
      return reply.send({ found: false });
    }

    return reply.send({
      found: true,
      barcode,
      scanned_at: result[0].created_at
    });
  });
}
