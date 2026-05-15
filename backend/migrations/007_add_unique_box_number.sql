-- 007_add_unique_box_number.sql
-- Добавляет partial unique index на box_number для finished коробов.
-- Защищает от race condition при параллельном создании коробов с одинаковым номером.
-- Работает только для status = 'finished', active короба не ограничиваются.

CREATE UNIQUE INDEX IF NOT EXISTS ux_boxes_finished_box_number
  ON boxes (box_number)
  WHERE status = 'finished';
