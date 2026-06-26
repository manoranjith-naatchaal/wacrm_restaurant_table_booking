-- ============================================================
-- 035_menu.sql — Menu (restaurant offering)
--
-- A flat list of menu items the restaurant can show to guests over
-- WhatsApp (via the `show_menu` flow node) and manage from the Menu
-- page. Kept single-table for v1 — `category` is denormalised free
-- text (same call made for `restaurant_tables.area` in 027); a
-- dedicated `menu_categories` lookup can be normalised later if
-- categories need their own attributes (images, descriptions, etc).
--
--   - account-scoped tenancy (`account_id`) + `user_id` for audit,
--     the same split every domain table has used since migration 017.
--   - `name` is the dish name; `description` an optional blurb.
--   - `category` groups items in the menu ("Starters", "Mains"). Free
--     text, optional — uncategorised items fall under a default group.
--   - `price` is NUMERIC(10,2), nullable (null = "market price" / POA).
--     Currency is the account's `default_currency` (migration 021) —
--     not stored per item, so a price change of currency is one edit.
--   - `is_available` soft-hides an item (86'd tonight) without losing
--     it; the show_menu node only renders available items.
--   - `sort_order` controls ordering within the menu; lower first.
--
-- RLS — settings-class (mirrors `restaurant_tables` in 027): any
-- member may read; admin+ may create/update/delete. The menu is
-- configuration, not day-to-day operational data.
--
-- Idempotent — table uses IF NOT EXISTS; policies dropped before
-- recreate (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Creator/audit only — never used for tenancy isolation. SET NULL
  -- on user delete so removing a teammate doesn't drop the item.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  -- Nullable: a null price renders as "—" (market price / ask staff).
  price NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "List this account's menu" is the dominant query; the secondary
-- columns match the render/list ordering (category, then sort_order).
CREATE INDEX IF NOT EXISTS idx_menu_items_account
  ON menu_items(account_id, category, sort_order);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS menu_items_select ON menu_items;
DROP POLICY IF EXISTS menu_items_insert ON menu_items;
DROP POLICY IF EXISTS menu_items_update ON menu_items;
DROP POLICY IF EXISTS menu_items_delete ON menu_items;

CREATE POLICY menu_items_select ON menu_items FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY menu_items_insert ON menu_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY menu_items_update ON menu_items FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY menu_items_delete ON menu_items FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- updated_at trigger — reuses update_updated_at_column() from
-- migration 001; trigger name matches every other table's.
DROP TRIGGER IF EXISTS set_updated_at ON menu_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
