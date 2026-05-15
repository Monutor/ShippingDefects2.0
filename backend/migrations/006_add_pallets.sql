-- 006_add_pallets.sql
-- Добавляем паллеты — контейнер верхнего уровня (миксы + отдельные товары)

CREATE TABLE IF NOT EXISTS pallets (
    id                  UUID PRIMARY KEY,
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    collector_id        VARCHAR(50),
    box_number          INTEGER,
    collector_full_name VARCHAR(255),
    seal                TEXT,           -- пломба (автоматически при завершении)
    finished_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pallet_items (
    id              SERIAL PRIMARY KEY,
    pallet_id       UUID REFERENCES pallets(id) ON DELETE CASCADE NOT NULL,
    source_type     VARCHAR(20) NOT NULL CHECK (source_type IN ('box', 'separate_item')),
    source_id       TEXT NOT NULL,    -- UUID короба или ID separate_item
    item_data       JSONB,            -- снимок данных товара при добавлении
    order_num       INTEGER NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pallets_status ON pallets(status);
CREATE INDEX IF NOT EXISTS idx_pallets_collector ON pallets(collector_id);
CREATE INDEX IF NOT EXISTS idx_pallet_items_pallet ON pallet_items(pallet_id);
CREATE INDEX IF NOT EXISTS idx_pallet_items_order ON pallet_items(pallet_id, order_num);
