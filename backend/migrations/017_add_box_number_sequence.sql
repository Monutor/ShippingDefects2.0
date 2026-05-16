-- 017_add_box_number_sequence.sql
-- Создаёт PostgreSQL SEQUENCE для автоматической нумерации коробов.
-- Box_number больше не зависит от общего количества строк (удалённые тестовые короба не влияют).

BEGIN;

-- Создаём sequence если нет — начинается с 1, инкремент +1
CREATE SEQUENCE IF NOT EXISTS box_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- Если таблица уже существует и есть данные — синхронизируем sequence
-- Пропускаем если таблица пуста — sequence останется на 1
DO $$
DECLARE
    max_val INTEGER;
BEGIN
    SELECT MAX(box_number) INTO max_val FROM boxes;
    IF max_val IS NOT NULL THEN
        PERFORM setval('box_number_seq', max_val);
    END IF;
END $$;

COMMIT;
