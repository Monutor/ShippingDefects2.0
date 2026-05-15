-- 018_drop_jsonb_columns.sql
-- Удаляем JSONB поля из pallet_items — они дублируют явные колонки после миграции 017

-- Сначала проверяем что все данные скопированы в явные колонки
DO $$
DECLARE
    empty_rows INTEGER;
BEGIN
    SELECT COUNT(*) INTO empty_rows 
    FROM pallet_items 
    WHERE barcode IS NULL OR barcode = '' 
       OR name IS NULL OR name = '';
    
    IF empty_rows > 0 THEN
        RAISE EXCEPTION 'Невозможно удалить JSONB поля: % записей имеют пустые явные колонки', empty_rows;
    END IF;
END $$;

-- Удаляем дублирующие JSONB поля
ALTER TABLE pallet_items DROP COLUMN item_data;
ALTER TABLE pallet_items DROP COLUMN item_data_jsonb;
