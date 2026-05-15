-- 003_add_collector_name.sql
-- Добавить имя сборщика в короба для отображения кто собрал

ALTER TABLE boxes ADD COLUMN IF NOT EXISTS collector_full_name VARCHAR(255);
