-- 018_drop_jsonb_columns.sql
-- Удаляем JSONB поля из pallet_items — они дублируют явные колонки после миграции 017

-- Удаляем дублирующие JSONB поля
ALTER TABLE pallet_items DROP COLUMN IF EXISTS item_data;
ALTER TABLE pallet_items DROP COLUMN IF EXISTS item_data_jsonb;

-- Удаляем GIN индекс если остался
DROP INDEX IF EXISTS idx_pallet_items_data_gin;
