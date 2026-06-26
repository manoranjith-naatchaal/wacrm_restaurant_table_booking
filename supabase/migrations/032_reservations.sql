-- ============================================================
-- 032_reservations.sql — Reservations (Booking domain capstone)
--
-- A concrete booking: a guest, on a date, at a time, for a party,
-- optionally seated at a table, moving through a status lifecycle.
--
-- Relationships:
--   - guest_id  → guests, ON DELETE RESTRICT. A reservation must
--     always have a guest, and history must survive: you can't delete
--     a guest who still has reservations (the API surfaces this as a
--     friendly 409 so staff cancel/reassign first).
--   - table_id  → restaurant_tables, ON DELETE SET NULL. The booking
--     outlives a retired table; it simply becomes unassigned.
--
-- Time model: a concrete `reservation_date` + `start_time` (+ optional
-- `end_time`). Whether that time is bookable is resolved at write time
-- against booking_slots + booking_exceptions (see lib/reservations/
-- availability.ts) — we store the concrete values, not a slot link, so
-- later edits to the weekly schedule never rewrite booked history.
--
-- `status` lifecycle:
--   pending → confirmed → seated → completed
--   (or) cancelled / no_show at any point.
-- `completed` is what counts as a "visit" in guest stats.
--
-- RLS — operational tier (mirrors guests): any member reads; agent+
-- writes. Front-of-house staff take and manage bookings.
--
-- Idempotent — IF NOT EXISTS table; policies/trigger dropped first.
-- ============================================================

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Creator/audit only; SET NULL so removing a teammate keeps the booking.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  table_id UUID REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  reservation_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  party_size INTEGER NOT NULL CHECK (party_size >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When an end time is given it must be after the start.
  CONSTRAINT reservations_time_order CHECK (end_time IS NULL OR end_time > start_time)
);

-- Day view: "this account's bookings on a date", newest service first.
CREATE INDEX IF NOT EXISTS idx_reservations_account_date
  ON reservations(account_id, reservation_date);
-- Guest history lookups.
CREATE INDEX IF NOT EXISTS idx_reservations_guest
  ON reservations(guest_id);
-- Table occupancy / conflict checks for a given date.
CREATE INDEX IF NOT EXISTS idx_reservations_table_date
  ON reservations(table_id, reservation_date)
  WHERE table_id IS NOT NULL;

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reservations_select ON reservations;
DROP POLICY IF EXISTS reservations_insert ON reservations;
DROP POLICY IF EXISTS reservations_update ON reservations;
DROP POLICY IF EXISTS reservations_delete ON reservations;

CREATE POLICY reservations_select ON reservations FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY reservations_insert ON reservations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY reservations_update ON reservations FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY reservations_delete ON reservations FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON reservations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
