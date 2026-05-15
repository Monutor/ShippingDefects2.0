-- 001_init.sql
-- Основная схема базы данных "Учёт брака"

CREATE TABLE IF NOT EXISTS app_settings (
    id          SERIAL PRIMARY KEY,
    key         VARCHAR(255) UNIQUE NOT NULL,
    value       TEXT NOT NULL DEFAULT 'false',
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collector_profiles (
    id              SERIAL PRIMARY KEY,
    employee_id     VARCHAR(50) UNIQUE NOT NULL,
    full_name       VARCHAR(255),
    position        VARCHAR(100),
    is_admin        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_items (
    id              SERIAL PRIMARY KEY,
    barcode         VARCHAR(100) NOT NULL,
    name            TEXT,
    brand           VARCHAR(255),
    model           VARCHAR(255),
    defect_type     VARCHAR(255),
    comment         TEXT,
    is_stop_item    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_items_barcode ON brain_items(barcode);
CREATE INDEX IF NOT EXISTS idx_brain_items_stop ON brain_items(is_stop_item) WHERE is_stop_item = true;

CREATE TABLE IF NOT EXISTS boxes (
    id              UUID PRIMARY KEY,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    collector_id    VARCHAR(50),
    finished_at     TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boxes_status ON boxes(status);

CREATE TABLE IF NOT EXISTS box_items (
    id              SERIAL PRIMARY KEY,
    box_id          UUID REFERENCES boxes(id) ON DELETE CASCADE NOT NULL,
    barcode         VARCHAR(100) NOT NULL,
    name            TEXT,
    brand           VARCHAR(255),
    model           VARCHAR(255),
    defect_type     VARCHAR(255),
    comment         TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_box_items_box_id ON box_items(box_id);
CREATE INDEX IF NOT EXISTS idx_box_items_barcode ON box_items(barcode);

-- Уникальность barcode enforced on application level (in boxes.js addItemToCurrentBox).
-- Не можем использовать partial index на родственный table (boxes.status) из box_items.

CREATE TABLE IF NOT EXISTS separate_items (
    id              SERIAL PRIMARY KEY,
    barcode         VARCHAR(100) NOT NULL,
    name            TEXT,
    brand           VARCHAR(255),
    model           VARCHAR(255),
    defect_type     VARCHAR(255),
    comment         TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_separate_items_barcode ON separate_items(barcode);

-- История сканирований (batched)
CREATE TABLE IF NOT EXISTS scan_history (
    id              SERIAL PRIMARY KEY,
    collector_id    VARCHAR(50) REFERENCES collector_profiles(employee_id),
    barcode         VARCHAR(100) NOT NULL,
    matched         BOOLEAN DEFAULT false,
    in_box          UUID,
    box_status      VARCHAR(20),
    batch_id        VARCHAR(100),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_history_collector ON scan_history(collector_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_batch ON scan_history(batch_id);
