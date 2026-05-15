-- 008_add_separate_container.sql
-- Отдельные товары привязываются к контейнеру (микс-короб или паллет)

ALTER TABLE separate_items
    ADD COLUMN container_id   UUID,
    ADD COLUMN container_type VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_separate_items_container ON separate_items(container_id);
