-- 009_add_pallet_source_type.sql
-- Добавляет 'pallet' в CHECK constraint pallet_items.source_type
-- Раньше были только: 'box', 'separate_item', 'inline'
-- Теперь: 'box', 'separate_item', 'inline', 'pallet'

ALTER TABLE pallet_items 
DROP CONSTRAINT IF EXISTS pallet_items_source_type_check,
ADD CONSTRAINT pallet_items_source_type_check 
CHECK (source_type IN ('box', 'separate_item', 'inline', 'pallet'));
