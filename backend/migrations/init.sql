-- warehouse-brain database schema
-- Consolidated migration script — idempotent, safe to run multiple times

-- ============================================================
-- 001: Core tables
-- ============================================================
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
    box_number      INTEGER,
    collector_full_name VARCHAR(255),
    finished_at     TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boxes_status ON boxes(status);
CREATE INDEX IF NOT EXISTS idx_boxes_number ON boxes(box_number);

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

CREATE TABLE IF NOT EXISTS separate_items (
    id              SERIAL PRIMARY KEY,
    barcode         VARCHAR(100) NOT NULL,
    name            TEXT,
    brand           VARCHAR(255),
    model           VARCHAR(255),
    defect_type     VARCHAR(255),
    comment         TEXT,
    container_id    UUID,
    container_type  VARCHAR(20),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_separate_items_barcode ON separate_items(barcode);
CREATE INDEX IF NOT EXISTS idx_separate_items_container ON separate_items(container_id);

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

-- ============================================================
-- 004: Fix null collector_id from scan_history
-- ============================================================
UPDATE boxes b
SET collector_id = sh.collector_id
FROM (
    SELECT DISTINCT ON (in_box) in_box, collector_id
    FROM scan_history
    WHERE in_box IS NOT NULL AND collector_id IS NOT NULL
    ORDER BY in_box, created_at DESC
) sh
WHERE b.id = sh.in_box
  AND b.collector_id IS NULL;

-- ============================================================
-- 006: Pallets
-- ============================================================
CREATE TABLE IF NOT EXISTS pallets (
    id                  UUID PRIMARY KEY,
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    collector_id        VARCHAR(50),
    pallet_number       INTEGER,
    collector_full_name VARCHAR(255),
    seal                TEXT,
    finished_at         TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pallet_items (
    id              SERIAL PRIMARY KEY,
    pallet_id       UUID REFERENCES pallets(id) ON DELETE CASCADE NOT NULL,
    source_type     VARCHAR(20) NOT NULL CHECK (source_type IN ('box', 'separate_item', 'inline', 'pallet')),
    source_id       TEXT NOT NULL,
    barcode         VARCHAR(100) NOT NULL DEFAULT '',
    name            TEXT NOT NULL DEFAULT '',
    brand           VARCHAR(255) NOT NULL DEFAULT '',
    model           VARCHAR(255) NOT NULL DEFAULT '',
    defect_type     VARCHAR(255) NOT NULL DEFAULT '',
    comment         TEXT NOT NULL DEFAULT '',
    scanned_at      TIMESTAMP WITH TIME ZONE,
    order_num       INTEGER NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pallets_status ON pallets(status);
CREATE INDEX IF NOT EXISTS idx_pallets_collector ON pallets(collector_id);
CREATE INDEX IF NOT EXISTS idx_pallet_items_pallet ON pallet_items(pallet_id);
CREATE INDEX IF NOT EXISTS idx_pallet_items_order ON pallet_items(pallet_id, order_num);
CREATE INDEX IF NOT EXISTS idx_pallet_items_barcode ON pallet_items(barcode);

-- ============================================================
-- 007: Unique box number for finished boxes
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS ux_boxes_finished_box_number
  ON boxes (box_number)
  WHERE status = 'finished';

-- ============================================================
-- 009: Pallet number sequence
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS seq_pallet_number;

DO $$
DECLARE
    max_val INTEGER;
BEGIN
    SELECT MAX(pallet_number) INTO max_val FROM pallets;
    IF max_val IS NOT NULL THEN
        PERFORM setval('seq_pallet_number', max_val);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pallets_finished_pallet_number
    ON pallets (pallet_number) WHERE status = 'finished';

-- ============================================================
-- 013-015: Unique constraints
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_box_items_active_barcode
    ON box_items(box_id, barcode);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pallet_items_unique_pallet
    ON pallet_items(pallet_id, source_id)
    WHERE source_type = 'pallet';

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_pallet_items_unique
    ON pallet_items(source_id)
    WHERE source_type = 'pallet';

-- ============================================================
-- 017: Box number sequence
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS box_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

DO $$
DECLARE
    max_val INTEGER;
BEGIN
    SELECT MAX(box_number) INTO max_val FROM boxes;
    IF max_val IS NOT NULL THEN
        PERFORM setval('box_number_seq', max_val);
    END IF;
END $$;

-- ============================================================
-- 017: Pallet items unique index for inline
-- ============================================================
DROP INDEX IF EXISTS idx_pallet_items_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pallet_items_unique
ON pallet_items (pallet_id, source_type, source_id)
WHERE source_type = 'inline';
