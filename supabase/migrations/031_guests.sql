-- ============================================================
-- 031_guests.sql — Guests (Booking domain)
--
-- A guest is a diner the restaurant books for. It optionally links
-- to a WhatsApp `contact` (the messaging identity) but keeps its
-- own booking-facing fields so a phone/walk-in guest can exist
-- without a contact, and so guest data (VIP, dietary needs) doesn't
-- pollute the CRM contact model.
--
--   - `contact_id` — optional link to contacts. ON DELETE SET NULL
--     so deleting a contact doesn't erase booking history; the guest
--     simply unlinks. Partial-unique per account so one contact maps
--     to at most one guest.
--   - `name` is required and self-contained (copied from the contact
--     at link time, editable after) — reservations and floor lists
--     read it directly without a join.
--   - `is_vip`, `dietary_notes`, `tags` are the booking-specific
--     extras. `tags` is a lightweight text[] (no join table needed
--     for this low-cardinality, guest-local use).
--
-- Visit stats and reservation history are DERIVED from the future
-- `reservations` table (guest_id FK), never stored here.
--
-- RLS — operational tier (mirrors contacts): any member reads;
-- agent+ writes. Front-of-house staff (agents) create guests during
-- booking; viewers are read-only.
--
-- Idempotent — IF NOT EXISTS table; policies/trigger dropped first.
-- ============================================================

CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Creator/audit only; SET NULL so removing a teammate keeps the guest.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Optional WhatsApp identity. SET NULL keeps the guest if the
  -- contact is later deleted.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  dietary_notes TEXT,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guests_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_guests_account ON guests(account_id);
CREATE INDEX IF NOT EXISTS idx_guests_contact ON guests(contact_id);

-- One guest per linked contact, per account (unlinked guests are
-- unconstrained — many walk-ins can share a NULL contact_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_guests_account_contact
  ON guests(account_id, contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guests_select ON guests;
DROP POLICY IF EXISTS guests_insert ON guests;
DROP POLICY IF EXISTS guests_update ON guests;
DROP POLICY IF EXISTS guests_delete ON guests;

CREATE POLICY guests_select ON guests FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY guests_insert ON guests FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY guests_update ON guests FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY guests_delete ON guests FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON guests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
