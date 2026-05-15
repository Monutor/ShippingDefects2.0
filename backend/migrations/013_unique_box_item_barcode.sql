-- 013_unique_box_item_barcode.sql
-- Запрещает одному товару (barcode) находиться в нескольких активных коробах одновременно.
-- finished boxes не затронуты — товары из завершённых миксов можно добавить снова.

CREATE UNIQUE INDEX IF NOT EXISTS idx_box_items_active_barcode
    ON box_items(box_id, barcode);
