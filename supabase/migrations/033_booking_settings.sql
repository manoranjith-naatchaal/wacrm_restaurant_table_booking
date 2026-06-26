-- ============================================================
-- 033_booking_settings.sql — Account-level booking configuration
--
-- A single row per account holding settings the booking domain needs
-- but that don't belong on any one reservation/slot. Introduced for
-- "booking via WhatsApp": the conversational blocks (`pick_date`,
-- `check_availability`) must resolve "today"/"tomorrow" and hide
-- already-passed times in the RESTAURANT's local timezone — which was
-- not stored anywhere until now.
--
--   - `timezone` — IANA tz name (e.g. 'Asia/Kolkata'). Drives the
--     server-side "what day/time is it for this restaurant" math. Kept
--     here (not on accounts) so booking config stays self-contained and
--     a future booking settings page edits one table.
--   - `default_turn_minutes` — how long a table is held per booking.
--     Reserved for computing reservation end_time later; nullable so
--     "no fixed turn time" is representable.
--
-- RLS — settings-class tier (mirrors restaurant_tables / booking_slots):
-- any member reads; admin+ writes. Timezone is a configuration knob,
-- not operational data agents touch per-shift.
--
-- Idempotent — IF NOT EXISTS table; policies/trigger dropped first.
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- Creator/audit of the last write; SET NULL keeps the row if the
  -- teammate is removed.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- IANA timezone. Default targets this deployment's locale (IST); the
  -- settings page lets each account override it.
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  -- Optional default booking duration (minutes). NULL = no fixed turn.
  default_turn_minutes INTEGER CHECK (default_turn_minutes IS NULL OR default_turn_minutes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE booking_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_settings_select ON booking_settings;
DROP POLICY IF EXISTS booking_settings_insert ON booking_settings;
DROP POLICY IF EXISTS booking_settings_update ON booking_settings;
DROP POLICY IF EXISTS booking_settings_delete ON booking_settings;

CREATE POLICY booking_settings_select ON booking_settings FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY booking_settings_insert ON booking_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_settings_update ON booking_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY booking_settings_delete ON booking_settings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON booking_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON booking_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
