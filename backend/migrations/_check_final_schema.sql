-- Проверка финальной схемы pallet_items после очистки JSONB полей
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'pallet_items' ORDER BY ordinal_position;
