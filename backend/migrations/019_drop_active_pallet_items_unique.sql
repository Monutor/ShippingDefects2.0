-- Migration 019: Remove overly restrictive unique index on pallet_items
-- idx_active_pallet_items_unique prevented adding a box to a new pallet
-- if it was already in a completed pallet. This was too restrictive.
-- We keep idx_pallet_items_unique_pallet which prevents duplicates within
-- the same pallet, and rely on backend checks for cross-pallet validation.

DROP INDEX IF EXISTS idx_active_pallet_items_unique;
