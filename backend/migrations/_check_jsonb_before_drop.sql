-- Проверка что все явные колонки заполнены перед удалением JSONB полей
SELECT 
    source_type,
    COUNT(*) as total,
    SUM(CASE WHEN barcode IS NULL OR barcode = '' THEN 1 ELSE 0 END) as empty_barcode,
    SUM(CASE WHEN name IS NULL OR name = '' THEN 1 ELSE 0 END) as empty_name
FROM pallet_items 
GROUP BY source_type;
