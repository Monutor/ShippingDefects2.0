import { query, pool } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';

/**
 * GET /api/boxes — список всех коробов
 */
export default async function boxesRoutes(app) {
  app.addHook('onRequest', async (request, reply) => {
    try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
  });

  app.get('/', async () => {
    const rows = await query('SELECT * FROM boxes ORDER BY created_at DESC');

    return rows.map((row) => ({
      ...row,
      name: row.box_number ? `Микс ${row.box_number}` : null,
      number: row.box_number || 0,
    }));
  });

  /**
   * GET /api/boxes/:id/items — товары конкретного короба
   */
  app.get('/:id/items', async (request, reply) => {
    // UUID validation
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid box ID (expected UUID)' });
    }

    const rows = await query(
      `SELECT bi.*, bi.name as item_name, bi.barcode as item_barcode
       FROM box_items bi WHERE bi.box_id = $1 ORDER BY bi.created_at`,
      [request.params.id]
    );
    return rows;
  });

  /**
   * GET /api/boxes/:id — получить один короб по ID
   */
  app.get('/:id', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid box ID (expected UUID)' });
    }

    const row = await query('SELECT * FROM boxes WHERE id = $1', [request.params.id]);
    if (!row || row.length === 0) {
      return reply.code(404).send({ error: 'Box not found' });
    }

    return {
      ...row[0],
      name: row[0].box_number ? `Микс ${row[0].box_number}` : null,
      number: row[0].box_number || 0,
    };
  });

  /**
   * POST /api/boxes — создать новый короб (active)
   */
  app.post('/', async (request, reply) => {
    const employeeId = request.user.employeeId;
    const boxId = crypto.randomUUID();

    // Сохраняем только collector_id — имя не храним, показываем табельный номер
    app.log.info(`CREATE box: ${employeeId}`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Получаем full_name сборщика из collector_profiles
      const profileResult = await client.query(
        "SELECT full_name FROM collector_profiles WHERE employee_id = $1",
        [employeeId]
      );
      const collectorFullName = profileResult.rows[0]?.full_name || null;

      // Сбросить sequence: если пусто → 1, иначе → MAX + 1
      const emptyCheck = await client.query('SELECT NOT EXISTS (SELECT 1 FROM boxes) AS empty');
      if (emptyCheck.rows[0].empty) {
        await client.query("SELECT setval('box_number_seq', 1, false)");
      } else {
        const maxResult = await client.query('SELECT COALESCE(MAX(box_number), 0) AS max FROM boxes');
        await client.query('SELECT setval(\'box_number_seq\', $1, true)', [maxResult.rows[0].max]);
      }

      // Берём следующий номер
      const seqResult = await client.query("SELECT nextval('box_number_seq')");
      const boxNumber = seqResult.rows[0].nextval;

      const result = await client.query(
        `INSERT INTO boxes (id, status, collector_id, collector_full_name, box_number)
         VALUES ($1, 'active', $2, $3, $4)
         RETURNING *`,
        [boxId, employeeId, collectorFullName, boxNumber]
      );
      await client.query('COMMIT');

      // Realtime broadcast: все клиенты увидят новый короб мгновенно
      broadcast({ type: 'box_created', box_id: boxId, collector_id: employeeId });

      return reply.code(201).send(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * PUT /api/boxes/:id — обновить короб (добавить item или завершить)
   */
  app.put('/:id', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid box ID' });
    }

    //Ownership guard: только создатель может редактировать активный короб
    const boxCheck = await query("SELECT collector_id, status FROM boxes WHERE id = $1", [request.params.id]);
    if (!boxCheck || boxCheck.length === 0) {
      return reply.code(404).send({ error: 'Короб не найден' });
    }

    // Если короб активный — проверяем что текущий пользователь его создал
    const boxStatus = boxCheck[0].status;
    const isOwner = boxCheck[0].collector_id === request.user.employeeId;
    
    if (boxStatus === 'active' && !isOwner) {
      const profileResult = await query(
        "SELECT full_name FROM collector_profiles WHERE employee_id = $1",
        [boxCheck[0].collector_id]
      );
      const ownerName = profileResult.rows[0]?.full_name || boxCheck[0].collector_id;
      return reply.code(403).send({ error: `Этот короб создан сотрудником ${ownerName} (${boxCheck[0].collector_id}). Только он может редактировать.` });
    }

    const body = request.body; // { status?, items?: [{barcode, name, brand, model, defect_type, comment}] }
    app.log.info(`PUT /boxes/${request.params.id.substring(0, 8)}... body.status=${body?.status}, hasItem=${!!body?.item}`);

    if (body.status === 'finished') {
      // Завершаем короб
      const result = await query("UPDATE boxes SET status = 'finished', finished_at = NOW() WHERE id = $1 AND collector_id = $2 RETURNING *", [request.params.id, request.user.employeeId]);

      app.log.info(`PUT finish box ${request.params.id}: affected=${result?.length || 0}`);

      if (!result || result.length === 0) {
        return reply.code(404).send({ error: 'Box not found' });
      }

      // Получаем все items короба для экспорта
      const items = await query(
        "SELECT * FROM box_items WHERE box_id = $1 ORDER BY created_at",
        [request.params.id]
      );

      // Broadcast всем клиентам что короб завершён — чтобы они обновили статус active → finished
      broadcast({ type: 'box_finished', box_id: request.params.id });

      return reply.send({ success: true, boxId: request.params.id, items });
    }

    if (body.status === 'active') {
      // Возвращаем в активное состояние (при синхронизации)
      await query("UPDATE boxes SET status = 'active', finished_at = NULL WHERE id = $1", [request.params.id]);
      return reply.send({ success: true, boxId: request.params.id });
    }

    // Добавляем отдельный item в короб (без дубликатов — проверяет фронтенд, но на всякий случай)
    if (body.item && body.item.barcode) {
      // FIX: используем уже загруженный boxCheck вместо второй проверки (TOCTOU fix)
      if (!isOwner || boxStatus !== 'active') {
        return reply.code(403).send({ error: 'Короб не найден или завершён' });
      }

      const existing = await query(
        `SELECT bi.*, b.status as box_status, b.box_number FROM box_items bi JOIN boxes b ON bi.box_id = b.id WHERE bi.barcode = $1`,
        [body.item.barcode]
      );

      if (existing.length > 0) {
        // Нашли где товар уже лежит — возвращаем информацию для клиента
        return reply.code(409).send({ 
          error: 'duplicate_in_box', 
          box_id: existing[0].box_id,
          box_number: existing[0].box_number,
          collector_id: request.user.employeeId // чтобы фронт мог проверить что это не свой короб
        });
      }

      try {
        await query(
          `INSERT INTO box_items (box_id, barcode, name, brand, model, defect_type, comment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            request.params.id, body.item.barcode, body.item.name || null,
            body.item.brand || null, body.item.model || null,
            body.item.defect_type || null, body.item.comment || null,
          ]
        )

        // Realtime broadcast: все открытые контейнеры обновятся мгновенно
        broadcast({ type: 'container:item_added', container_id: request.params.id, source_type: 'box_item' })

        return reply.code(201).send({ success: true });
      } catch (err) {
        // L6 fix: ловим PostgreSQL UNIQUE violation (даже если check выше прошёл — race condition между проверкой и INSERT)
        if (err?.code === '23505') {
          app.log.warn(`UNIQUE conflict for barcode ${body.item.barcode} in box ${request.params.id}`);

          // Находим где товар лежит чтобы вернуть номер короба
          const whereBox = await query(
            `SELECT bi.box_id, b.box_number FROM box_items bi JOIN boxes b ON bi.box_id = b.id WHERE bi.barcode = $1`,
            [body.item.barcode]
          );

          let duplicateInfo = { error: 'duplicate_in_box', detail: `Товар уже добавлен в короб №?` };
          if (whereBox && whereBox.length > 0) {
            const dupBoxNumber = whereBox[0].box_number || '?';
            duplicateInfo.box_id = whereBox[0].box_id;
            duplicateInfo.box_number = dupBoxNumber;

            // Broadcast всем клиентам что товар добавлен в этот короб — чтобы другие видели актуальное состояние
            broadcast({ type: 'container:item_added', container_id: whereBox[0].box_id, source_type: 'box_item' });
          } else {
            duplicateInfo.box_number = '?';
          }

          return reply.code(409).send(duplicateInfo);
        }
        throw err;
      }
    } // закрываем if (body.item && body.item.barcode)

    return reply.code(400).send({ error: 'Missing status or item' });
  });

  /**
   * DELETE /api/box-items/:id — удалить товар из короба
   */
  app.delete('/box-items', async (request, reply) => {
    const boxId = request.query.box_id;
    const barcode = request.query.barcode;

    if (!boxId || !barcode) {
      return reply.code(400).send({ error: 'Missing box_id or barcode' });
    }

    // Ownership guard
    const boxCheck = await query("SELECT collector_id, status FROM boxes WHERE id = $1", [boxId]);
    if (!boxCheck || boxCheck.length === 0) {
      return reply.code(404).send({ error: 'Короб не найден' });
    }
    if (boxCheck[0].status === 'active' && boxCheck[0].collector_id !== request.user.employeeId) {
      const profileResult = await query(
        "SELECT full_name FROM collector_profiles WHERE employee_id = $1",
        [boxCheck[0].collector_id]
      );
      const ownerName = profileResult.rows[0]?.full_name || boxCheck[0].collector_id;
      return reply.code(403).send({ error: `Этот короб создан сотрудником ${ownerName} (${boxCheck[0].collector_id}). Только он может редактировать.` });
    }

    try {
      await query('DELETE FROM box_items WHERE box_id = $1 AND barcode = $2', [boxId, barcode]);
      return reply.send({ success: true });
    } catch (err) {
      app.log.error('Ошибка удаления item из короба:', err);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/boxes/:id — удалить короб (active или finished)
   */
  app.delete('/:id', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid box ID' });
    }

    // Проверяем статус и владельца короба
    const checkResult = await query("SELECT status, collector_id FROM boxes WHERE id = $1", [request.params.id]);
    if (!checkResult || checkResult.length === 0) {
      return reply.code(404).send({ error: 'Короб не найден' });
    }

    // Если короб активный — только создатель может удалить
    if (checkResult[0].status === 'active') {
      if (checkResult[0].collector_id !== request.user.employeeId) {
        const profileResult = await query(
          "SELECT full_name FROM collector_profiles WHERE employee_id = $1",
          [checkResult[0].collector_id]
        );
        const ownerName = profileResult.rows[0]?.full_name || checkResult[0].collector_id;
        return reply.code(403).send({ error: `Этот короб создан сотрудником ${ownerName} (${checkResult[0].collector_id}). Только он может отменить.` });
      }
    }

    // M4 fix: только админ может удалять finished короба (как DELETE /api/boxes)
    const is_admin = request.user?.is_admin || false;
    if (!is_admin && checkResult[0].status === 'finished') {
      return reply.code(403).send({ error: 'Только администратор может удалять короба' });
    }

    // Удаляем товары короба
    await query('DELETE FROM box_items WHERE box_id = $1', [request.params.id]);
    // Удаляем сам короб
    await query('DELETE FROM boxes WHERE id = $1', [request.params.id]);

    return reply.send({ success: true, deletedBoxId: request.params.id });
  });

  /**
   * DELETE /api/boxes — очистить все finished короба (admin only)
   */
  app.delete('/', async (request, reply) => {
    const is_admin = request.user?.is_admin || false;
    if (!is_admin) return reply.code(403).send({ error: 'Только админ' });

    // Удаляем все короба и их items (admin only)
    await query('DELETE FROM box_items');
    await query('DELETE FROM boxes');
    await query("SELECT setval('box_number_seq', 1, false)");
    console.log('🗑️ Все короба очищены (admin), sequence сброшена');

    // Уведомляем всех клиентов об очистке коробов
    broadcast({ type: 'boxes_cleared' });

    return reply.send({ success: true, deletedBoxes: 'all' });
  });
}
