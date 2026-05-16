-- 017_add_box_number_sequence.sql
-- Создаёт PostgreSQL SEQUENCE для автоматической нумерации коробов.
-- Box_number больше не зависит от общего количества строк (удалённые тестовые короба не влияют).

BEGIN;

-- Создаём sequence если нет — начинается с 1, инкремент +1
CREATE SEQUENCE IF NOT EXISTS box_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- Если таблица уже существует и есть данные — синхронизируем sequence
-- setval(..., 0, false) — false разрешает значение ниже минимума, nextval вернёт 1
SELECT setval('box_number_seq', COALESCE((SELECT MAX(box_number) FROM boxes), 0), false);

COMMIT;
