-- 017_fix_box_number_sequence.sql
-- Полная пересоздание SEQUENCE для корректной нумерации коробов

BEGIN;

-- Удаляем старую sequence если есть
DROP SEQUENCE IF EXISTS box_number_seq;

-- Создаём новую
CREATE SEQUENCE box_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- Синхронизируем с существующими данными
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
