-- Проверка inline items и unique индекса
SELECT source_type, COUNT(*) FROM pallet_items GROUP BY source_type;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pallet_items';
SELECT COUNT(*) as not_null_barcode FROM pallet_items WHERE barcode IS NOT NULL AND barcode != '';
