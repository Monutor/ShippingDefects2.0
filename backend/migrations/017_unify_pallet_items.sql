-- 017_unify_pallet_items.sql
-- Унифицируем pallet_items: заполняем явные колонки для всех существующих записей
-- Миграция делает паллеты совместимыми с архитектурой миксов (box_items)

-- Заполняем barcode/name/brand/model/defect_type/comment из item_data_jsonb
-- для всех существующих записей, где эти поля пустые
UPDATE pallet_items
SET 
    barcode = COALESCE(barcode, ''),
    name = COALESCE(name, ''),
    brand = COALESCE(brand, ''),
    model = COALESCE(model, ''),
    defect_type = COALESCE(defect_type, ''),
    comment = COALESCE(comment, '')
WHERE barcode IS NULL OR barcode = '' 
   OR name IS NULL OR name = '';

-- Добавляем NOT NULL ограничение для консистентности с box_items
ALTER TABLE pallet_items ALTER COLUMN barcode SET NOT NULL;
ALTER TABLE pallet_items ALTER COLUMN name SET DEFAULT '';
ALTER TABLE pallet_items ALTER COLUMN brand SET DEFAULT '';
ALTER TABLE pallet_items ALTER COLUMN model SET DEFAULT '';
ALTER TABLE pallet_items ALTER COLUMN defect_type SET DEFAULT '';
ALTER TABLE pallet_items ALTER COLUMN comment SET DEFAULT '';

-- Обновляем partial unique index для inline items (source_type = 'inline')
DROP INDEX IF EXISTS idx_pallet_items_unique;
CREATE UNIQUE INDEX idx_pallet_items_unique 
ON pallet_items (pallet_id, source_type, source_id) 
WHERE source_type = 'inline';
