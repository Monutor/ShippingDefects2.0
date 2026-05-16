-- 017_unify_pallet_items.sql
-- Унифицируем pallet_items: заполняем явные колонки для всех существующих записей
-- Миграция делает паллеты совместимыми с архитектурой миксов (box_items)

-- Заполняем barcode/name/brand/model/defect_type/comment для записей где они пустые
-- (на случай если 016 не захватила какие-то записи)
UPDATE pallet_items
SET 
    barcode = COALESCE(NULLIF(barcode, ''), ''),
    name = COALESCE(NULLIF(name, ''), ''),
    brand = COALESCE(NULLIF(brand, ''), ''),
    model = COALESCE(NULLIF(model, ''), ''),
    defect_type = COALESCE(NULLIF(defect_type, ''), ''),
    comment = COALESCE(NULLIF(comment, ''), '')
WHERE barcode IS NULL OR barcode = '' 
   OR name IS NULL OR name = ''
   OR brand IS NULL
   OR model IS NULL
   OR defect_type IS NULL
   OR comment IS NULL;

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
