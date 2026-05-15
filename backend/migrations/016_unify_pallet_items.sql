-- 016_unify_pallet_items.sql
-- Унифицируем pallet_items: добавляем явные колонки как в box_items

-- Добавляем новые колонки
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS brand VARCHAR(255);
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS model VARCHAR(255);
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS defect_type VARCHAR(255);
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE pallet_items ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMP WITH TIME ZONE;

-- Заполняем данные из item_data_jsonb для существующих записей
UPDATE pallet_items 
SET barcode = COALESCE(item_data->>'barcode', ''),
    name = COALESCE(item_data->>'name', ''),
    brand = COALESCE(item_data->>'brand', ''),
    model = COALESCE(item_data->>'model', ''),
    defect_type = COALESCE(item_data->>'defect_type', ''),
    comment = COALESCE(item_data->>'comment', '')
WHERE barcode IS NULL;

-- Заполняем scanned_at из item_data_jsonb если есть
UPDATE pallet_items 
SET scanned_at = (item_data->>'scanned_at')::timestamp
WHERE scanned_at IS NULL AND item_data->>'scanned_at' != '';

-- Добавляем индекс для поиска по barcode (как в box_items)
CREATE INDEX IF NOT EXISTS idx_pallet_items_barcode ON pallet_items(barcode);

