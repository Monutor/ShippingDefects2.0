import { query, queryRaw } from '../db/index.js';

/**
 * GET /api/separate — список отдельных items
 */
export default async function separateRoutes(app) {
  app.addHook('onRequest', async (request, reply) => {
    try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
  });

  /**
   * GET /api/separate — все separate items с полными данными из brain_items
   */
  app.get('/', async () => {
    const rows = await query(
      `SELECT si.*, bi.name as brain_name, bi.brand as brain_brand, bi.model as brain_model,
              bi.defect_type as brain_defect, bi.comment as brain_comment, bi.is_stop_item
       FROM separate_items si
       LEFT JOIN brain_items bi ON si.barcode = bi.barcode
       ORDER BY si.created_at DESC`
    );
    return rows;
  });

  /**
   * POST /api/separate — добавить отдельный item (не привязанный к контейнеру)
   */
  app.post('/', async (request, reply) => {
    const item = request.body.item || request.body;

    if (!item.barcode) {
      return reply.code(400).send({ error: 'barcode обязателен' });
    }

    const result = await queryRaw(
      `INSERT INTO separate_items (barcode, name, brand, model, defect_type, comment, container_id, container_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        item.barcode, item.name || null, item.brand || null,
        item.model || null, item.defect_type || null, item.comment || null,
        item.containerId || null, item.containerType || null,
      ]
    );

    const insertedId = result?.rows?.[0]?.id;
    return reply.code(201).send({ success: true, id: insertedId, barcode: item.barcode });
  });

  /**
   * DELETE /api/separate/:id — удалить отдельный item
   */
  app.delete('/:id', async (request, reply) => {
    const param = request.params.id;

    // Сначала пробуем как целочисленный ID
    const id = parseInt(param, 10);
    if (!isNaN(id)) {
      const is_admin = request.user?.is_admin || false;
      let result;
      if (is_admin) {
        result = await queryRaw('DELETE FROM separate_items WHERE id = $1 RETURNING id', [id]);
      } else {
        result = await queryRaw(
          `DELETE FROM separate_items si
           USING boxes b
           WHERE si.id = $1 AND si.container_id::text = b.id::text AND si.container_type = 'box' AND b.collector_id = $2
           RETURNING si.id`,
          [id, request.user.employeeId]
        );
      }
      if (result.rowCount > 0) {
        return reply.send({ success: true, deletedId: id });
      }
    }

    // Fallback: удаление по barcode — только владелец контейнера или admin
    const is_admin = request.user?.is_admin || false;
    let deleteResult;
    if (is_admin) {
      // Admin может удалять любой item по barcode
      deleteResult = await queryRaw('DELETE FROM separate_items WHERE barcode = $1', [param]);
    } else {
      // Обычный пользователь — только если item из его контейнера (box или pallet)
      deleteResult = await queryRaw(
        `DELETE FROM separate_items si USING boxes b
         WHERE si.barcode = $1 AND si.container_id::text = b.id::text AND si.container_type = 'box' AND b.collector_id = $2`,
        [param, request.user.employeeId]
      );

      // Если не нашли в box — пробуем pallet (через pallets через boxes)
      if (!deleteResult?.rowCount) {
        deleteResult = await queryRaw(
          `DELETE FROM separate_items si USING pallets p
           WHERE si.barcode = $1 AND si.container_id::text = p.id::text AND si.container_type = 'pallet' AND p.collector_id = $2`,
          [param, request.user.employeeId]
        );
      }

      if (!deleteResult?.rowCount) {
        return reply.code(403).send({ error: 'У вас нет прав на удаление этого товара' });
      }
    }

    if (!deleteResult.rowCount) {
      return reply.code(404).send({ error: 'Товар не найден' });
    }

    return reply.send({ success: true, deletedByBarcode: param });
  });

  /**
   * DELETE /api/separate — очистить все (admin only)
   */
  app.delete('/', async (request, reply) => {
    const is_admin = request.user?.is_admin || false;
    if (!is_admin) return reply.code(403).send({ error: 'Только админ' });

    await query('DELETE FROM separate_items');
    return reply.send({ success: true, deletedItems: 'all_separate' });
  });

  /**
   * GET /api/separate/by-container/:id — separate items для контейнера
   */
  app.get('/by-container/:id', async (request, reply) => {
    const containerId = request.params.id;
    const type = request.query.type; // 'box' или 'pallet'

    if (!type || !['box', 'pallet'].includes(type)) {
      return reply.code(400).send({ error: 'Некорректный type. Ожидается box или pallet' });
    }

    const rows = await query(
      `SELECT si.*, bi.name as brain_name, bi.brand as brain_brand, bi.model as brain_model,
              bi.defect_type as brain_defect, bi.comment as brain_comment, bi.is_stop_item
       FROM separate_items si
       LEFT JOIN brain_items bi ON si.barcode = bi.barcode
       WHERE si.container_id = $1 AND si.container_type = $2
       ORDER BY si.created_at DESC`,
      [containerId, type]
    );
    return rows;
  });

  /**
   * DELETE /api/separate/by-container/:id — удалить separate items контейнера (admin only)
   */
  app.delete('/by-container/:id', async (request, reply) => {
    const is_admin = request.user?.is_admin || false;
    if (!is_admin) return reply.code(403).send({ error: 'Только админ' });

    const containerId = request.params.id;
    await query('DELETE FROM separate_items WHERE container_id = $1', [containerId]);
    return reply.send({ success: true, deletedItems: 'by_container' });
  });
}
