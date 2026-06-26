-- ============================================================
-- 027_restaurant_tables.sql — Tables & Seating (Booking domain)
--
-- First module of the restaurant booking domain. Defines the
-- physical seating inventory a reservation is later assigned to.
--
-- `restaurant_tables` (named with the `restaurant_` prefix to avoid
-- colliding with the SQL reserved word `tables` and the
-- information_schema view):
--   - account-scoped tenancy (`account_id`, the new hot key), plus
--     `user_id` for audit/"who added this" — same split every
--     domain table has used since migration 017.
--   - `label` is the human name on the floor ("T1", "Window 4");
--     UNIQUE per account so two tables can't share a label.
--   - `capacity` is the seat count; CHECK keeps it positive.
--   - `area` is a free-text zone ("Indoor", "Patio", "Bar"). Kept
--     denormalised for v1 — a dedicated `dining_areas` lookup can
--     be normalised in later if zones need their own attributes.
--   - `is_active` lets an operator retire a table without deleting
--     it (and losing its reservation history later) — soft-disable.
--
-- RLS — settings-class (mirrors `pipelines` / `tags` in 017):
--   any member may read; admin+ may create/update/delete. Seating
--   layout is configuration, not day-to-day operational data.
--
-- Idempotent — safe to run multiple times. Table uses IF NOT
-- EXISTS; policies are dropped before recreate (Postgres has no
-- CREATE POLICY IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Creator/audit only — never used for tenancy isolation. SET NULL
  -- on user delete so removing a teammate doesn't drop the table.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 1),
  area TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Labels are unique within an account; two accounts may both have a "T1".
  UNIQUE (account_id, label)
);

-- "List this account's tables" is the dominant query.
CREATE INDEX IF NOT EXISTS idx_restaurant_tables_account
  ON restaurant_tables(account_id);

ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_tables_select ON restaurant_tables;
DROP POLICY IF EXISTS restaurant_tables_insert ON restaurant_tables;
DROP POLICY IF EXISTS restaurant_tables_update ON restaurant_tables;
DROP POLICY IF EXISTS restaurant_tables_delete ON restaurant_tables;

CREATE POLICY restaurant_tables_select ON restaurant_tables FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY restaurant_tables_insert ON restaurant_tables FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY restaurant_tables_update ON restaurant_tables FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY restaurant_tables_delete ON restaurant_tables FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- updated_at trigger — reuses update_updated_at_column() from
-- migration 001; trigger name matches every other table's.
DROP TRIGGER IF EXISTS set_updated_at ON restaurant_tables;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
