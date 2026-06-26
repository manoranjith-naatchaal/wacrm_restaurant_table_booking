-- ============================================================
-- 029_remove_slot_capacity.sql
--
-- Drops `capacity` from booking_slots. Capacity is a property of
-- physical seating (restaurant_tables), not of a time window — a
-- slot just says "this weekday, this time range is bookable".
-- Reservation capacity will be derived from assigned tables.
--
-- Forward-only fix: migration 028 shipped with the column to the
-- shared dev DB, so we drop it here rather than editing 028 (never
-- rewrite an applied migration). IF EXISTS keeps fresh environments
-- and re-runs safe.
-- ============================================================

ALTER TABLE booking_slots DROP COLUMN IF EXISTS capacity;
