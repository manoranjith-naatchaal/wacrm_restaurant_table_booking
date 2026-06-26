-- ============================================================
-- 028_booking_slots.sql — Slots & Timings (Booking domain)
--
-- Defines WHEN guests can book: recurring weekly time windows.
-- One row = "on this weekday, a bookable slot runs start_time →
-- end_time with this capacity". Reservations (a later migration)
-- resolve a calendar date to its weekday and book into the matching
-- slot; `capacity` is the ceiling that prevents overbooking.
--
--   - `day_of_week` SMALLINT 0..6, 0 = Sunday (matches JS
--     Date.getDay() so the app needs no remapping).
--   - `start_time` / `end_time` are TIME (no date, no zone) — the
--     slot recurs every matching weekday. end_time > start_time is
--     enforced so a window can't be inverted/zero-length.
--   - `capacity` is total covers (or reservations) the slot can
--     hold; CHECK keeps it positive.
--   - `is_active` soft-disables a slot without deleting its history.
--   - UNIQUE (account_id, day_of_week, start_time) — one slot per
--     start time per weekday per account.
--
-- RLS — settings-class (mirrors restaurant_tables / pipelines):
--   any member reads; admin+ writes. Availability is configuration.
--
-- Idempotent — IF NOT EXISTS table; policies dropped before
-- recreate (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Creator/audit only; SET NULL so removing a teammate keeps the slot.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booking_slots_time_order CHECK (end_time > start_time),
  UNIQUE (account_id, day_of_week, start_time)
);

-- "List this account's slots" is the dominant query.
CREATE INDEX IF NOT EXISTS idx_booking_slots_account
  ON booking_slots(account_id);

-- Availability lookup for a given weekday (used by Reservations).
CREATE INDEX IF NOT EXISTS idx_booking_slots_account_day
  ON booking_slots(account_id, day_of_week)
  WHERE is_active = TRUE;

ALTER TABLE booking_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_slots_select ON booking_slots;
DROP POLICY IF EXISTS booking_slots_insert ON booking_slots;
DROP POLICY IF EXISTS booking_slots_update ON booking_slots;
DROP POLICY IF EXISTS booking_slots_delete ON booking_slots;

CREATE POLICY booking_slots_select ON booking_slots FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY booking_slots_insert ON booking_slots FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_slots_update ON booking_slots FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_slots_delete ON booking_slots FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON booking_slots;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON booking_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
