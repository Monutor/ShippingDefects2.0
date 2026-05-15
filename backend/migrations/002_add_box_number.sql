-- 002_add_box_number.sql
-- Добавить колонку number для хранения номера короба (Микс N)

ALTER TABLE boxes ADD COLUMN IF NOT EXISTS box_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_boxes_number ON boxes(box_number);
