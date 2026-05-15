-- 004_fix_null_collector_id.sql
-- Обновляем NULL collector_id для старых коробов на основе scan_history
-- Используем in_box (UUID) вместо box_status (VARCHAR action type: 'scan', 'added')
-- Если нет истории сканирований — оставляем NULL (невозможно определить автора)

UPDATE boxes b
SET collector_id = sh.collector_id
FROM (
    SELECT DISTINCT ON (in_box) in_box, collector_id
    FROM scan_history
    WHERE in_box IS NOT NULL AND collector_id IS NOT NULL
    ORDER BY in_box, created_at DESC
) sh
WHERE b.id = sh.in_box
  AND b.collector_id IS NULL;

-- Для коробов без истории — ставим placeholder (будет показан как "Неизвестный")
-- Это ожидаемое поведение: мы не знаем кто создал такой короб
