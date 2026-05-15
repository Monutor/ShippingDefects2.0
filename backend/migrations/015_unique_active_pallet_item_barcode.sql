-- 015_unique_active_pallet_item_barcode.sql
-- Запрещает одному товару находиться в нескольких АКТИВНЫХ паллетах одновременно.
-- finished pallets не ограничены — можно добавить тот же товар в новый паллет после завершения старого.

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_pallet_items_unique
    ON pallet_items(source_id)
    WHERE source_type = 'pallet';
