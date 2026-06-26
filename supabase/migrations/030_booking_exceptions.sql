-- ============================================================
-- 030_booking_exceptions.sql — Closures & Exceptions (Booking)
--
-- Date-specific OVERRIDES on top of the recurring weekly schedule
-- (booking_slots). The weekly slots describe the normal week; this
-- table describes the deviations, and overrides always win when
-- availability is resolved for a calendar date.
--
-- `kind`:
--   'closed_all_day' — the date(s) are fully closed (e.g. holiday).
--                      No time component.
--   'closed_time'    — closed for a time window each day in range
--                      (e.g. staff half-day: block 13:00–23:00).
--   'open_special'   — OPEN for a special window even if the weekday
--                      has no slot (e.g. a one-off festival lunch).
--
-- Date range: [start_date, end_date]. A single day sets them equal.
-- A multi-day closure (vacation 24th–26th) is one row.
--
-- Time columns apply per day across the whole range and are:
--   - NULL for 'closed_all_day'
--   - NOT NULL (end > start) for 'closed_time' / 'open_special'
-- enforced by the booking_exceptions_shape CHECK so bad rows can't
-- exist regardless of which client writes them.
--
-- RLS — settings-class (mirrors booking_slots / restaurant_tables):
--   any member reads; admin+ writes. Availability is configuration.
--
-- Idempotent — IF NOT EXISTS table; policies/trigger dropped first.
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_exceptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Creator/audit only; SET NULL so removing a teammate keeps the row.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('closed_all_day', 'closed_time', 'open_special')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booking_exceptions_date_order CHECK (end_date >= start_date),
  -- All-day rows carry no times; timed rows must carry an ordered pair.
  CONSTRAINT booking_exceptions_shape CHECK (
    (kind = 'closed_all_day' AND start_time IS NULL AND end_time IS NULL)
    OR (
      kind IN ('closed_time', 'open_special')
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time > start_time
    )
  )
);

-- Availability lookup: "exceptions for this account overlapping a date".
CREATE INDEX IF NOT EXISTS idx_booking_exceptions_account_dates
  ON booking_exceptions(account_id, start_date, end_date);

ALTER TABLE booking_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_exceptions_select ON booking_exceptions;
DROP POLICY IF EXISTS booking_exceptions_insert ON booking_exceptions;
DROP POLICY IF EXISTS booking_exceptions_update ON booking_exceptions;
DROP POLICY IF EXISTS booking_exceptions_delete ON booking_exceptions;

CREATE POLICY booking_exceptions_select ON booking_exceptions FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY booking_exceptions_insert ON booking_exceptions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_exceptions_update ON booking_exceptions FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_exceptions_delete ON booking_exceptions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON booking_exceptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON booking_exceptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
