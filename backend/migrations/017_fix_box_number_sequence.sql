-- 017_fix_box_number_sequence.sql
-- Полная пересоздание SEQUENCE для корректной нумерации коробов

BEGIN;

-- Удаляем старую sequence если есть
DROP SEQUENCE IF EXISTS box_number_seq;

-- Создаём новую
CREATE SEQUENCE box_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- Синхронизируем с существующими данными
SELECT setval('box_number_seq', COALESCE((SELECT MAX(box_number) FROM boxes), 0));

COMMIT;
