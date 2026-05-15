-- 017_fix_box_number_sequence.sql
-- Полная пересоздание SEQUENCE для корректной нумерации коробов

BEGIN;

-- Удаляем старую sequence если есть (если она была создана с неправильным значением)
DROP SEQUENCE IF EXISTS box_number_seq;

-- Создаём новую — начинается с 1
CREATE SEQUENCE box_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

COMMIT;
