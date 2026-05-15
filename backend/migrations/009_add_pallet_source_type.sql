-- 008_add_pallet_source_type.sql
-- Добавляет 'pallet' в CHECK constraint pallet_items.source_type
-- Раньше были только: 'box', 'separate_item', 'inline'
-- Теперь: 'box', 'separate_item', 'inline', 'pallet'

DO $$
BEGIN
    -- Проверяем, что constraint ещё не содержит 'pallet'
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_get_expr(c.conbin, c.conrelid) AS expr ON c.oid = c.oid
        WHERE c.conname = 'pallet_items_source_type_check'
          AND expr::text LIKE '%''pallet'''
    ) THEN
        ALTER TABLE pallet_items 
        DROP CONSTRAINT pallet_items_source_type_check,
        ADD CONSTRAINT pallet_items_source_type_check 
        CHECK (source_type IN ('box', 'separate_item', 'inline', 'pallet'));
        
        RAISE NOTICE 'Добавлен "pallet" в pallet_items.source_type constraint';
    ELSE
        RAISE NOTICE '"pallet" уже есть в pallet_items.source_type constraint, пропускаем';
    END IF;
END $$;
