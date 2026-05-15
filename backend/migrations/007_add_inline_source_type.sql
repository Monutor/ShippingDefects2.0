-- 007_add_inline_source_type.sql
-- Добавляем 'inline' в допустимые source_type для pallet_items
-- inline = товары добавленные вручную при сканировании (не из короба и не separate)

ALTER TABLE pallet_items
  DROP CONSTRAINT IF EXISTS pallet_items_source_type_check;

ALTER TABLE pallet_items
  ADD CONSTRAINT pallet_items_source_type_check
    CHECK (source_type IN ('box', 'separate_item', 'inline'));
