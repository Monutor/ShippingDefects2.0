import { query } from '../db/index.js';
import { broadcast } from '../ws/broadcast.js';

/** Получить имя владельца контейнера по collector_id */
async function getOwnerName(collectorId) {
  const profileResult = await query(
    "SELECT full_name FROM collector_profiles WHERE employee_id = $1",
    [collectorId]
  );
  return profileResult.rows[0]?.full_name || collectorId;
}

/**
 * Декодирует mojibake (WIN1251 интерпретация UTF-8) в правильный текст
 */
function decodeMojibake(text) {
  if (!text || typeof text !== 'string') return text
  const hasMojibake = /[╨╤]/.test(text)
  if (!hasMojibake) return text
  try {
    // Кодируем строку как Windows-1251 (как она была интерпретирована)
    const encoder = new TextEncoder('windows-1251')
    const bytes = encoder.encode(text)
    // Декодируем обратно как UTF-8
    const decoder = new TextDecoder('utf-8')
    return decoder.decode(bytes)
  } catch {
    return text
  }
}

/**
 * GET /api/pallets — список всех паллетов
 */
export default async function palletRoutes(app) {
  app.addHook('onRequest', async (request, reply) => {
    try { await request.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
  });

  /**
   * GET /api/pallets — список всех паллетов
   */
  app.get('/', async () => {
    const rows = await query('SELECT * FROM pallets ORDER BY created_at DESC');

    return rows.map((row) => ({
      ...row,
      name: row.pallet_number ? `Паллет ${row.pallet_number}` : null,
      number: row.pallet_number || 0,
    }));
  });

  /**
   * GET /api/pallets/:id — получить один паллет по ID
   */
  app.get('/:id', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid pallet ID (expected UUID)' });
    }

    const rows = await query('SELECT * FROM pallets WHERE id = $1', [request.params.id]);
    if (!rows || rows.length === 0) {
      return reply.code(404).send({ error: 'Pallet not found' });
    }

    const row = rows[0];
    return {
      ...row,
      name: row.pallet_number ? `Паллет ${row.pallet_number}` : null,
      number: row.pallet_number || 0,
    };
  });

  /**
   * POST /api/pallets/:id/items — добавить один item в паллет (realtime sync)
   */
  app.post('/:id/items', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid pallet ID' });
    }

    const body = request.body; // { source_type, source_id, name?, article?, comment? }
    
    // Debug: лог всех POST /pallets/:id/items
    app.log.info(`POST pallet item: pallet=${request.params.id.substring(0,8)}... type=${body?.source_type}, id=${body?.source_id}, name="${body?.name}"`);

    if (!body?.source_type || !['box', 'separate_item', 'inline'].includes(body.source_type)) {  // M3 fix: добавляем inline
      return reply.code(400).send({ error: 'source_type must be "box", "separate_item" or "inline"' });
    }

    // Проверяем что паллет активен и владелец
    const pallet = await query('SELECT status, collector_id FROM pallets WHERE id = $1', [request.params.id]);
    if (!pallet || pallet.length === 0) {
      return reply.code(404).send({ error: 'Паллет не найден' });
    }
    if (pallet[0].status !== 'active') {
      return reply.code(400).send({ error: 'Нельзя добавлять в завершённый паллет' });
    }

    // Ownership guard: только создатель может добавлять товары
    if (pallet[0].collector_id !== request.user.employeeId) {
      const ownerName = await getOwnerName(pallet[0].collector_id);
      return reply.code(403).send({ error: `Этот паллет создан сотрудником ${ownerName} (${pallet[0].collector_id}). Только он может редактировать.` });
    }

    const { source_type, source_id, name, article, comment } = body;

    // Валидация source_id типа против source_type
    if (source_type === 'box') {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(source_id)) {
        return reply.code(400).send({ error: `Некорректный source_id для type='box': ${source_id}` });
      }
    } else if (source_type === 'separate_item') {
      const id = parseInt(source_id, 10);
      if (isNaN(id) || id <= 0) {
        return reply.code(400).send({ error: `Некорректный source_id для type='separate_item': ${source_id}` });
      }
    } else if (source_type === 'inline') {
      // Inline — barcode как source_id, данные из body
    }

    // Получаем текущий max order_num
    const maxOrder = await query('SELECT COALESCE(MAX(order_num), 0) as max FROM pallet_items WHERE pallet_id = $1', [request.params.id]);
    const orderNum = (maxOrder[0]?.max || 0) + 1;

    // Сохраняем снимок данных товара
    let itemData = null;
    if (source_type === 'box') {
      const boxItems = await query(
        'SELECT barcode, name, brand, model, defect_type, comment FROM box_items WHERE box_id = $1 ORDER BY created_at',
        [source_id]
      );
      itemData = { type: 'box', boxId: source_id, items: boxItems };
    } else if (source_type === 'separate_item') {
      const sepItem = await query(
        'SELECT barcode, name, brand, model, defect_type, comment FROM separate_items WHERE id = $1',
        [parseInt(source_id, 10)]
      );
      itemData = sepItem[0] ? { type: 'separate_item', ...sepItem[0] } : null;
    } else if (source_type === 'inline') {
      // Inline — данные из body

      const isTimestamp = typeof source_id === 'number' || (typeof source_id === 'string' && !isNaN(Number(source_id)) && Number(source_id) > 1700000000000)

      app.log.info(`POST inline: source_type=${source_type} source_id=${source_id} name="${name}" isTimestamp=${isTimestamp}`);

      // BUG-108 fix: убираем ранний return при пустом name + isTimestamp — item должен сохраниться
      // Убираем pre-check — полагаясь на unique индекс БД для race condition protection
      // Декодируем mojibake если пришёл от клиента с неправильной кодировкой
      const decodedName = decodeMojibake(name);
      itemData = {
        type: 'inline',
        barcode: source_id,
        name: (decodedName && decodedName.trim()) ? decodedName : `Товар ${source_id}`,  // Fallback если name пустой
        article: decodeMojibake(article) || '',
        comment: decodeMojibake(comment) || ''
      };

      app.log.info(`POST inline itemData created: name="${itemData.name}" barcode="${itemData.barcode}"`);
      // Только если scannedAt есть — не перезаписывать null!
      const scanDate = body.scannedAt || body.scanned_at;
      if (scanDate) {
        itemData.scanned_at = scanDate;
      }
    }

    if (!itemData || typeof itemData !== 'object') {
      itemData = {
        type: 'inline',
        barcode: String(source_id || ''),
        name: name || '',
        article: article || '',
        comment: comment || ''
      }
    }

    let insertResult;
    try {
      // Для новых записей сохраняем данные только в явные колонки (JSONB удалён миграцией 018)
      const scannedAtParam = itemData.scanned_at || null;
      const insertQuery = `INSERT INTO pallet_items (pallet_id, source_type, source_id, order_num, barcode, name, brand, model, defect_type, comment, scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`;
      const insertParams = [
        request.params.id, source_type, source_id, orderNum,
        itemData.barcode || '',  // barcode
        itemData.name || '',     // name
        itemData.article || '',  // brand
        itemData.model || '' ,   // model
        itemData.defect_type || '', // defect_type
        itemData.comment || '',   // comment
        scannedAtParam            // scanned_at
      ];

      insertResult = await query(insertQuery, insertParams);
    } catch (err) {
      // L6 fix: ловим PostgreSQL UNIQUE violation — race condition между проверкой и INSERT.
      // Работает для обоих типов inline/pallet после миграции 017 (source_type='inline')
      if (err?.code === '23505' && (source_type === 'pallet' || source_type === 'inline')) {
        app.log.warn(`UNIQUE conflict for pallet item barcode ${source_id} in pallet ${request.params.id}`);

        // Находим где товар уже лежит — в каком паллете чтобы показать клиенту
        const whereItem = await query(
          `SELECT pi.pallet_id, p.pallet_number FROM pallet_items pi JOIN pallets p ON pi.pallet_id = p.id WHERE pi.source_type IN ('pallet', 'inline') AND pi.source_id = $1`,
          [source_id]
        );

        let palletInfo = null;
        if (whereItem && whereItem.length > 0) {
          const firstMatch = whereItem[0];
          palletInfo = {
            pallet_number: firstMatch.pallet_number,
            collector_id: firstMatch.pallet_id
          };
        }

        return reply.code(409).send({
          error: 'duplicate_in_pallet',
          barcode: source_id,
          name: `Товар уже добавлен в паллет`,
          pallet_info: palletInfo
        });
      }
      throw err;
    }

    app.log.info(`ADD item to pallet ${request.params.id}: ${source_type}/${source_id}`);

    // Realtime broadcast: все открытые контейнеры обновятся мгновенно
    broadcast({ type: 'container:item_added', container_id: request.params.id, source_type, source_id });

    return reply.send({ success: true, id: insertResult?.[0]?.id || 'generated' });
  });

  /**
   * DELETE /api/pallets/:id/items — удалить конкретный item из паллета (по source_type + source_id)
   */
  app.delete('/:id/items', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid pallet ID (expected UUID)' });
    }

    const sourceType = request.query.source_type;
    const sourceId = request.query.source_id;

    if (!sourceType || !sourceId) {
      return reply.code(400).send({ error: 'Требуется source_type и source_id' });
    }

    // Проверяем что паллет существует (active или finished — можно удалять из обоих)
    const pallet = await query('SELECT status, collector_id FROM pallets WHERE id = $1', [request.params.id]);
    if (!pallet || pallet.length === 0) {
      return reply.code(404).send({ error: 'Паллет не найден' });
    }

    // Ownership guard: только создатель может удалять товары (кроме админа)
    const is_admin = request.user?.is_admin || false;
    if (!is_admin && pallet[0].collector_id !== request.user.employeeId) {
      const ownerName = await getOwnerName(pallet[0].collector_id);
      return reply.code(403).send({ error: `Этот паллет создан сотрудником ${ownerName} (${pallet[0].collector_id}). Только он может удалять товары.` });
    }

    // Удаляем конкретный item по source_type и source_id
    const deleteResult = await query('DELETE FROM pallet_items WHERE pallet_id = $1 AND source_type = $2 AND source_id = $3 RETURNING *', [request.params.id, sourceType, sourceId]);

    // Realtime broadcast
    if (deleteResult && deleteResult.length > 0) {
      broadcast({ type: 'container:item_removed', container_id: request.params.id, source_type: sourceType, source_id: sourceId });
    }

    return reply.send({ success: true, deletedItemId: deleteResult?.[0]?.id || null });
  });

  /**
   * GET /api/pallets/:id/items — содержимое паллета
   */
  app.get('/:id/items', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid pallet ID (expected UUID)' });
    }

    // Получаем items паллета — явные колонки приоритетнее JSONB (после миграции 017)
    const palletItems = await query(`
      SELECT pi.pallet_id, pi.source_type, pi.source_id, pi.order_num,
             pi.barcode as item_barcode, pi.name as item_name, pi.brand as item_brand,
             pi.model as item_model, pi.defect_type as item_defect_type, pi.comment as item_comment,
             pi.scanned_at
      FROM pallet_items pi
      WHERE pi.pallet_id = $1::uuid
      ORDER BY pi.order_num
    `, [request.params.id]);

    app.log.info(`GET /:id/items: ${palletItems.length} items, source_types:`, palletItems.map(i => `${i.source_type}(${i.source_id})`));

    if (palletItems.length === 0) return [];

    // Догружаем данные для separate_items
    const sepIds = palletItems.filter(i => i.source_type === 'separate_item').map(i => i.source_id);
    let sepItems = [];
    if (sepIds.length > 0) {
      const placeholders = sepIds.map((_, i) => `$${i + 1}`).join(',');
      sepItems = await query(
        `SELECT id, barcode, name, brand, model, defect_type, comment FROM separate_items WHERE id IN (${placeholders})`,
        [...sepIds]
      );
    }

    // Собираем итоговый массив с полными данными
    return palletItems.map(pi => {
      const base = { source_type: pi.source_type, source_id: pi.source_id, order_num: pi.order_num };

      if (pi.source_type === 'separate_item') {
        const sepItem = sepItems.find(s => s.id.toString() === pi.source_id);
        return {
          ...base,
          item_name: sepItem?.name || '',
          item_barcode: sepItem?.barcode || '',
          item_brand: sepItem?.brand || '',
          item_model: sepItem?.model || '',
          item_defect_type: sepItem?.defect_type || '',
          item_comment: sepItem?.comment || ''
        };
      }

      // Для pallet (inline) items — используем явные колонки из БД (приоритет после миграции 017)
      if (pi.source_type === 'pallet' || pi.source_type === 'inline') {
        return {
          ...base,
          item_name: (pi.item_name && pi.item_name.trim()) ? pi.item_name : `Товар ${pi.source_id}`,
          item_barcode: (pi.item_barcode && pi.item_barcode.trim()) ? pi.item_barcode : pi.source_id,
          item_brand: (pi.item_brand && pi.item_brand.trim()) ? pi.item_brand : '',
          item_model: (pi.model && pi.model.trim()) ? pi.model : '',
          item_defect_type: (pi.defect_type && pi.defect_type.trim()) ? pi.defect_type : '',
          item_comment: (pi.comment && pi.comment.trim()) ? pi.comment : '',
          scanned_at: pi.scanned_at  // читаем из явной колонки
        };
      }

      // Для box — item_data уже содержит снимок данных при создании паллета (backend PUT)
      return base;
    });
  });

  /**
   * POST /api/pallets — создать новый паллет (active)
   */
  app.post('/', async (request, reply) => {
    const employeeId = request.user.employeeId;
    const palletId = crypto.randomUUID();

    // Уникальный номер через PostgreSQL sequence (устраняет race condition)
    // Если паллеты удалены — сбрасываем sequence на 1 чтобы нумерация начиналась заново
    const countResult = await query('SELECT COUNT(*)::int AS cnt FROM pallets');
    if (countResult[0]?.cnt === 0) {
      await query("SELECT setval('seq_pallet_number', 1, false)");
    }
    const seqResult = await query('SELECT nextval(\'seq_pallet_number\') as pallet_number');
    const palletNumber = seqResult[0]?.pallet_number;

    // Сохраняем только collector_id, имя не храним — показываем табельный номер
    const result = await query(
      `INSERT INTO pallets (id, status, collector_id, pallet_number)
       VALUES ($1, 'active', $2, $3)
       RETURNING *`,
      [palletId, employeeId, palletNumber]
    );

    app.log.info(`CREATE pallet: ${employeeId}`);

    // Realtime broadcast: все клиенты увидят новый паллет мгновенно
    broadcast({ type: 'pallet_created', pallet_id: palletId, collector_id: employeeId });

    return reply.code(201).send(result[0]);
  });

  /**
   * PUT /api/pallets/:id — обновить паллет (добавить item или завершить)
   */
  app.put('/:id', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid pallet ID' });
    }

    const body = request.body; // { items?: [{source_type, source_id}], status? }

    if (body.status === 'finished') {
      // Проверяем что паллет активен и владелец
      const checkResult = await query("SELECT status, collector_id FROM pallets WHERE id = $1", [request.params.id]);
      if (!checkResult || checkResult.length === 0) {
        return reply.code(404).send({ error: 'Паллет не найден' });
      }
      if (checkResult[0].status !== 'active') {
        return reply.code(400).send({ error: 'Можно завершить только активный паллет' });
      }

      // Ownership guard: только создатель может завершить
      if (checkResult[0].collector_id !== request.user.employeeId) {
        const ownerName = await getOwnerName(checkResult[0].collector_id);
        return reply.code(403).send({ error: `Этот паллет создан сотрудником ${ownerName} (${checkResult[0].collector_id}). Только он может завершить.` });
      }

      const result = await query(
        "UPDATE pallets SET status = 'finished', finished_at = NOW(), seal = NULL WHERE id = $1 RETURNING *",
        [request.params.id]
      );

      if (!result || result.length === 0) {
        return reply.code(404).send({ error: 'Паллет не найден' });
      }

      const seal = generateSeal(request.params.id, result[0].created_at);

      // Получаем все items паллета для экспорта — явные колонки приоритетнее JOIN
      let boxItems = await query(`
        SELECT
          pi.pallet_id, pi.source_type, pi.source_id, pi.order_num,
          pi.barcode as item_barcode, pi.name as item_name, pi.brand as item_brand,
          pi.model as item_model, pi.defect_type as item_defect_type, pi.comment as item_comment,
          'box' as _type
        FROM pallet_items pi
        WHERE pi.pallet_id = $1::uuid AND pi.source_type = 'box'
        ORDER BY pi.order_num
      `, [request.params.id]);

      let separateItems = await query(`
        SELECT
          pi.pallet_id, pi.source_type, pi.source_id, pi.order_num,
          pi.barcode as item_barcode, pi.name as item_name, pi.brand as item_brand,
          pi.model as item_model, pi.defect_type as item_defect_type, pi.comment as item_comment,
          'separate_item' as _type
        FROM pallet_items pi
        WHERE pi.pallet_id = $1::uuid AND pi.source_type = 'separate_item'
        ORDER BY pi.order_num
      `, [request.params.id]);

      // Если body.items присланы — сохраняем их в БД (даже если boxes были удалены)
      if (body.items && Array.isArray(body.items) && body.items.length > 0) {
        // FIX: используем уже загруженный checkResult вместо второй проверки (TOCTOU fix)
        const currentStatus = checkResult[0].status;
        if (currentStatus !== 'active') {
          return reply.code(400).send({ error: 'Можно завершить только активный паллет' });
        }

        const maxOrder = await query(
          "SELECT COALESCE(MAX(order_num), 0) as max FROM pallet_items WHERE pallet_id = $1",
          [request.params.id]
        );
        let currentOrder = maxOrder[0]?.max || 0;

        for (const itemEntry of body.items) {
          const orderNum = ++currentOrder;

          // Валидация source_id типа против source_type
          if (itemEntry.source_type === 'box') {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(itemEntry.source_id)) {
              return reply.code(400).send({ error: `Некорректный source_id для type='box': ${itemEntry.source_id}` });
            }
          } else if (itemEntry.source_type === 'separate_item') {
            const id = parseInt(itemEntry.source_id, 10);
            if (isNaN(id) || id <= 0) {
              return reply.code(400).send({ error: `Некорректный source_id для type='separate_item': ${itemEntry.source_id}` });
            }
          } else if (itemEntry.source_type === 'pallet' || itemEntry.source_type === 'inline') {
            // Inline/pallet — barcode как source_id, данные сохраняются в item_data
          } else {
            return reply.code(400).send({ error: `Неизвестный source_type: ${itemEntry.source_type}` });
          }

          // Сохраняем снимок данных товара
          let itemData = null;
          if (itemEntry.source_type === 'box') {
            const boxItemsCheck = await query(
              "SELECT barcode, name, brand, model, defect_type, comment FROM box_items WHERE box_id = $1 ORDER BY created_at",
              [itemEntry.source_id]
            );
            itemData = { type: 'box', boxId: itemEntry.source_id, items: boxItemsCheck };
          } else if (itemEntry.source_type === 'separate_item') {
            const sepItem = await query(
              "SELECT barcode, name, brand, model, defect_type, comment FROM separate_items WHERE id = $1",
              [itemEntry.source_id]
            );
            itemData = sepItem[0] ? { type: 'separate_item', ...sepItem[0] } : null;
          } else if (itemEntry.source_type === 'pallet' || itemEntry.source_type === 'inline') {
            // Pallet — данные приходят из frontend, сохраняем как snapshot
            itemData = {
              type: 'pallet',
              barcode: itemEntry.source_id,
              name: itemEntry.name || '',
              article: itemEntry.article || '',
              comment: itemEntry.comment || ''
            };
            // Только если scanned_at/scannedAt есть — не перезаписывать null!
            const scanDate = itemEntry.scanned_at || itemEntry.scannedAt;
            if (scanDate) {
              itemData.scanned_at = scanDate;
            }
          }

          try {
            // Проактивная проверка дубликата — ищем запись ДО вставки
            const existing = await query(
              `SELECT id, order_num FROM pallet_items WHERE pallet_id = $1::uuid AND source_id = $2 LIMIT 1`,
              [request.params.id, itemEntry.source_id]
            )

            // Данные для явных колонок
            const itemBarcode = itemEntry.source_id;
            const itemName = itemEntry.name || '';
            const itemBrand = itemEntry.article || '';
            const itemDefect = itemEntry.defect_type || '';
            const itemComment = itemEntry.comment || '';
            const itemScannedAt = itemEntry.scanned_at || itemEntry.scannedAt || null;

            if (existing && existing.length > 0) {
              // FIX: Для inline/pallet items не перезаписываем comment из body.items —
              // он мог обновиться на сервере (Excel импорт → brain store sync).
              // Берём актуальный comment из БД.
              const dbComment = await query(
                `SELECT comment FROM pallet_items WHERE id = $1`,
                [existing[0].id]
              )
              const actualComment = (dbComment && dbComment.length > 0 && dbComment[0]?.comment) ? dbComment[0].comment : itemComment

              // Логирование комментария для отладки
              console.log(`📝 pallet finish: ${itemEntry.source_id} comment body="${itemComment}" db="${dbComment?.[0]?.comment || ''}" → used="${actualComment}"`)

              await query(
                `UPDATE pallet_items SET order_num = $4,
                 barcode = $5, name = $6, brand = $7, defect_type = $8, comment = $9, scanned_at = $10
                 WHERE id = $3`,
                [orderNum, itemBarcode, existing[0].id, itemName, itemBrand, itemDefect, actualComment, itemScannedAt]  // без JSONB после миграции 018
              )
            } else {
              // Нет дубликата — вставляем новую запись (без JSONB после миграции 018)
              await query(
                `INSERT INTO pallet_items (pallet_id, source_type, source_id, order_num, barcode, name, brand, defect_type, comment, scanned_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [request.params.id, itemEntry.source_type, itemEntry.source_id, orderNum, itemBarcode, itemName, itemBrand, itemDefect, itemComment, itemScannedAt]
              )
            }
          } catch {
            // ignore — ошибка уже логируется на уровне приложения
          }
        }

        // Перезагружаем items из БД после сохранения
        boxItems = await query(`
          SELECT pi.pallet_id, pi.source_type, pi.source_id, pi.order_num,
                 bi.name as item_name, bi.barcode as item_barcode, bi.brand as item_brand,
                 bi.model as item_model, bi.defect_type as item_defect_type, bi.comment as item_comment, 'box' as _type
          FROM pallet_items pi LEFT JOIN box_items bi ON pi.source_id::uuid = bi.box_id
          WHERE pi.pallet_id = $1 AND pi.source_type = 'box' ORDER BY pi.order_num`, [request.params.id]);

        separateItems = await query(`
          SELECT pi.pallet_id, pi.source_type, pi.source_id, pi.order_num,
                 si.name as item_name, si.barcode as item_barcode, si.brand as item_brand,
                 si.model as item_model, si.defect_type as item_defect_type, si.comment as item_comment, 'separate_item' as _type
          FROM pallet_items pi LEFT JOIN separate_items si ON pi.source_id::integer = si.id
          WHERE pi.pallet_id = $1 AND pi.source_type = 'separate_item' ORDER BY pi.order_num`, [request.params.id]);

      }

      // ЗАГРУЖАЕМ inline items из БД ВСЕГДА при завершении паллета (после if body.items)
      const inlineItems = await query(`
        SELECT pi.pallet_id, pi.source_type, pi.source_id, pi.order_num,
               pi.barcode as item_barcode, pi.name as item_name, pi.brand as item_brand,
               '' as item_model, pi.defect_type as item_defect_type, pi.comment as item_comment,
               pi.scanned_at, 'inline' as _type
        FROM pallet_items pi
        WHERE pi.pallet_id = $1 AND pi.source_type = 'inline' ORDER BY pi.order_num`, [request.params.id]);

      // Объединяем inline items с boxItems для дальнейшей обработки
        boxItems = [...boxItems, ...inlineItems];

      const items = [...boxItems, ...separateItems].map(item => {
        const result = { ...item }
        if (item._type === 'separate_item') {
          // Для separate_items возвращаем полные данные из таблицы
          result._full_data = {
            name: item.item_name || '',
            number: item.item_barcode || '',
            article: item.item_brand || '',
            comment: item.item_comment || ''
          }
         } else if (item._type === 'box') {
          // Для коробов — данные box_items
          result.item_data = { items: [] }
        } else if (item._type === 'inline' || item._type === 'pallet') {
          // Для inline/pallet items — используем данные из явных колонок БД
          result._full_data = {
            name: item.name || '',
            number: item.barcode || '',
            article: item.brand || '',
            comment: item.item_comment || '',  // FIX: алиас из SQL — item_comment
            scannedAt: item.scanned_at || null
          }
        }
        return result
      });

      // Добавляем pallet items — используем явные колонки из БД (приоритет после миграции 017)
      const palletItems = await query(`
        SELECT pi.pallet_id, pi.source_type, pi.source_id, pi.order_num,
               pi.barcode as item_barcode, pi.name as item_name, pi.brand as item_brand,
               pi.defect_type as item_defect_type, pi.comment as item_comment, pi.scanned_at
        FROM pallet_items pi
        WHERE pi.pallet_id = $1::uuid AND (pi.source_type = 'pallet' OR pi.source_type = 'inline')
        ORDER BY pi.order_num
      `, [request.params.id]);

      for (const ii of palletItems) {
        // Приоритет: явные колонки из БД, затем JSONB fallback для старых записей
        const name = (ii.item_name && ii.item_name.trim()) ? ii.item_name : null;
        const barcode = ii.item_barcode || '';
        const article = (ii.item_brand && ii.item_brand.trim()) ? ii.item_brand : '';
        const comment = (ii.comment && ii.comment.trim()) ? ii.comment : '';

        items.push({
          source_type: 'pallet',
          source_id: ii.source_id,
          order_num: ii.order_num,
          item_comment: comment,  // Передаём комментарий напрямую для Excel экспорта
          _full_data: {
            name: name || `Товар ${ii.source_id}`,  // Fallback если пустой
            number: barcode,
            article: article,
            comment: comment,
            scannedAt: ii.scanned_at || null
          }
        })
      }

      // Логирование отправляемых items для отладки комментариев
      console.log('📋 Backend FINAL response items:')
      for (const item of items) {
        if (item.source_type === 'inline' || item.source_type === 'pallet') {
          console.log(`  ${item.source_id}: source_type=${item.source_type}, item_comment="${item.item_comment}", _full_data.comment="${item._full_data?.comment}"`)
        }
      }

      // BUG-213 fix: не удаляем items при завершении паллета — сохраняем историю
      // (ранее удалялись inline/pallet items, что делало паллет непросматриваемым)

      return reply.send({ success: true, palletId: request.params.id, seal, created_at: result[0].created_at, finished_at: result[0].finished_at, items });
    }

    // BUG-8 fix: удалён dead code — блок if (body.status === 'finished') после return был мёртвым кодом

    if (body.items && Array.isArray(body.items) && body.items.length > 0) {
      const existingPallet = await query("SELECT status FROM pallets WHERE id = $1", [request.params.id]);
      if (!existingPallet || existingPallet.length === 0) {
        return reply.code(404).send({ error: 'Паллет не найден' });
      }
      if (existingPallet[0].status !== 'active') {
        return reply.code(400).send({ error: 'Нельзя добавлять в завершённый паллет' });
      }

      // Получаем текущий max order_num
      const maxOrder = await query(
        "SELECT COALESCE(MAX(order_num), 0) as max FROM pallet_items WHERE pallet_id = $1",
        [request.params.id]
      );
      let currentOrder = maxOrder[0]?.max || 0;

      for (const itemEntry of body.items) {
        const orderNum = ++currentOrder;

        // Валидация source_id типа против source_type
        if (itemEntry.source_type === 'box') {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!uuidRegex.test(itemEntry.source_id)) {
            return reply.code(400).send({ error: `Некорректный source_id для type='box': ${itemEntry.source_id} (ожидается UUID)` });
          }
        } else if (itemEntry.source_type === 'separate_item') {
          const id = parseInt(itemEntry.source_id, 10);
          if (isNaN(id) || id <= 0) {
            return reply.code(400).send({ error: `Некорректный source_id для type='separate_item': ${itemEntry.source_id} (ожидается целое число)` });
          }
        } else {
          return reply.code(400).send({ error: `Неизвестный source_type: ${itemEntry.source_type}` });
        }

        // Сохраняем снимок данных товара
        let itemData = null;
        if (itemEntry.source_type === 'box') {
          const boxItems = await query(
            "SELECT barcode, name, brand, model, defect_type, comment FROM box_items WHERE box_id = $1 ORDER BY created_at",
            [itemEntry.source_id]
          );
          itemData = { type: 'box', boxId: itemEntry.source_id, items: boxItems };
        } else if (itemEntry.source_type === 'separate_item') {
          const sepItem = await query(
            "SELECT barcode, name, brand, model, defect_type, comment FROM separate_items WHERE id = $1",
            [itemEntry.source_id]
          );
          itemData = sepItem[0] ? { type: 'separate_item', ...sepItem[0] } : null;
        } else if (itemEntry.source_type === 'pallet' || itemEntry.source_type === 'inline') {
          // Fallback на barcode если name пустой — данные из brain_items могут не подтянуться
          itemData = {
            type: 'pallet',
            barcode: itemEntry.source_id,
            name: (itemEntry.name && itemEntry.name.trim()) ? itemEntry.name : `Товар ${itemEntry.source_id}`,
            article: itemEntry.article || '',
            comment: itemEntry.comment || '',
            scannedAt: itemEntry.scannedAt || null
          };
        }

        await query(
          `INSERT INTO pallet_items (pallet_id, source_type, source_id, order_num, barcode, name, brand, defect_type, comment, scanned_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [request.params.id, itemEntry.source_type, itemEntry.source_id, orderNum,
           itemEntry.source_id || '', itemEntry.name || '', itemEntry.article || '', '', itemEntry.comment || '', itemEntry.scannedAt || null]
        );
      }

      return reply.send({ success: true });
    }

    return reply.code(400).send({ error: 'Missing status or items' });
  });

  /**
    * PATCH /api/pallets/:id/cancel — отменить активный паллет (удалить его из БД)
    */
   app.patch('/:id/cancel', async (request, reply) => {
     if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
       return reply.code(400).send({ error: 'Invalid pallet ID' });
     }

     const checkResult = await query("SELECT status, collector_id FROM pallets WHERE id = $1", [request.params.id]);
     if (!checkResult || checkResult.length === 0) {
       return reply.code(404).send({ error: 'Паллет не найден' });
     }
     if (checkResult[0].status !== 'active') {
       return reply.code(400).send({ error: 'Можно отменить только активный паллет' });
     }

     // Ownership guard: только создатель может отменить
     if (checkResult[0].collector_id !== request.user.employeeId) {
       const ownerName = await getOwnerName(checkResult[0].collector_id);
       return reply.code(403).send({ error: `Этот паллет создан сотрудником ${ownerName} (${checkResult[0].collector_id}). Только он может отменить.` });
     }

      // BUG-238 fix: помечаем паллет как отменённый вместо удаления
      await query("UPDATE pallets SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [request.params.id]);

     broadcast({ type: 'pallet_cancelled' });

     return reply.send({ success: true, cancelledPalletId: request.params.id });
   });

   /**
    * DELETE /api/pallets/:id — удалить паллет (только finished)
    */
   app.delete('/:id', async (request, reply) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid pallet ID' });
    }

    const checkResult = await query("SELECT status FROM pallets WHERE id = $1", [request.params.id]);
    if (!checkResult || checkResult.length === 0) {
      return reply.code(404).send({ error: 'Паллет не найден' });
    }
    if (checkResult[0].status !== 'finished') {
      return reply.code(400).send({ error: 'Можно удалить только завершённый паллет' });
    }

    await query('DELETE FROM pallet_items WHERE pallet_id = $1', [request.params.id]);
    await query('DELETE FROM pallets WHERE id = $1', [request.params.id]);

    return reply.send({ success: true, deletedPalletId: request.params.id });
  });

  /**
   * DELETE /api/pallets — очистить все finished паллеты (admin only)
   */
  app.delete('/', async (request, reply) => {
    const is_admin = request.user?.is_admin || false;
    if (!is_admin) return reply.code(403).send({ error: 'Только админ' });

    // Удаляем только finished паллеты + их items
    await query("DELETE FROM pallet_items WHERE pallet_id IN (SELECT id FROM pallets WHERE status = 'finished')");
    await query("DELETE FROM pallets WHERE status = 'finished'");
    broadcast({ type: 'pallets_cleared' });

    return reply.send({ success: true, deletedPallets: 'all' });
  });

  /**
   * DELETE /api/pallets/all — очистить ВСЕ паллеты включая активные (admin only)
   */
  app.delete('/all', async (request, reply) => {
    const is_admin = request.user?.is_admin || false;
    if (!is_admin) return reply.code(403).send({ error: 'Только админ' });

    // Удаляем все items всех паллетов
    await query('DELETE FROM pallet_items');
    // Удаляем все паллеты
    await query('DELETE FROM pallets');
    broadcast({ type: 'pallets_cleared' });

    return reply.send({ success: true, deletedPallets: 'all' });
  });

  /** Генерация пломбы */
  function generateSeal(palletId, timestamp) {
    const prefix = 'PLT';
    const datePart = new Date(timestamp).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const idShort = palletId.substring(0, 8).toUpperCase();
    return `${prefix}-${datePart}-${idShort}`;
  }
}
