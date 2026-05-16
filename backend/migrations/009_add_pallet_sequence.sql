-- 009_add_pallet_sequence.sql
-- Устраняет race condition при создании паллетов: заменяем SELECT COUNT на атомарный sequence
-- Переименовывает box_number → pallet_number (паллеты ≠ коробки)

-- Переименовываем колонку для ясности: box_number относится к коробам, у паллетов свой номер
ALTER TABLE pallets RENAME COLUMN box_number TO pallet_number;

-- Переименовываем индекс, если он существует
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_pallets_finished_box_number') THEN
        EXECUTE 'ALTER INDEX ux_pallets_finished_box_number RENAME TO ux_pallets_finished_pallet_number';
    END IF;
END $$;

-- Создаём sequence для нумерации паллетов (если не создана)
CREATE SEQUENCE IF NOT EXISTS seq_pallet_number;

-- Присваиваем номера всем паллетам без номера (в порядке created_at)
UPDATE pallets SET pallet_number = nextval('seq_pallet_number') WHERE pallet_number IS NULL;

-- Устанавливаем sequence на следующий номер после макс существующего
-- setval(..., 0, false) — false разрешает значение ниже минимума, nextval вернёт 1
DO $$
BEGIN
    PERFORM setval('seq_pallet_number', COALESCE((SELECT MAX(pallet_number) FROM pallets), 0), false);
END $$;

-- Обновляем unique partial index под новое имя колонки
DROP INDEX IF EXISTS ux_pallets_finished_pallet_number;
CREATE UNIQUE INDEX ux_pallets_finished_pallet_number
    ON pallets (pallet_number) WHERE status = 'finished';
