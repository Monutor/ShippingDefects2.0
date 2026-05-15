-- 014_unique_pallet_item_barcode.sql
-- Запрещает одному товару (source_id) находиться в паллете дважды.
-- Partial unique index: только для source_type = 'pallet' (inline items не ограничиваем).

CREATE UNIQUE INDEX IF NOT EXISTS idx_pallet_items_unique_pallet
    ON pallet_items(pallet_id, source_id)
    WHERE source_type = 'pallet';
