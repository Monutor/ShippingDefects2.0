-- 006_item_data_jsonb.sql
-- Конвертация pallet_items.item_data из TEXT → JSONB + GIN индекс

-- 1. Добавить новую колонку JSONB
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS item_data_jsonb JSONB;

-- 2. Скопировать данные (для пустых значений — NULL)
UPDATE pallet_items SET item_data_jsonb = item_data::jsonb WHERE item_data IS NOT NULL;

-- 3. Создать GIN индекс для быстрых JSONB-запросов
CREATE INDEX IF NOT EXISTS idx_pallet_items_data_gin ON pallet_items USING gin(item_data_jsonb);

-- 4. Сделать колонку NOT NULL по умолчанию
ALTER TABLE pallet_items ALTER COLUMN item_data_jsonb SET DEFAULT NULL;
