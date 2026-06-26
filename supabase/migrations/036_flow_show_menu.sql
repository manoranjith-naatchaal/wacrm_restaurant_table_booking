-- ============================================================
-- 036_flow_show_menu.sql — "Show menu" flow node type
--
-- Adds a `show_menu` node so restaurants can drop their menu into any
-- WhatsApp flow (e.g. before asking for a booking). The node composes
-- a text message from the account's available `menu_items` (grouped by
-- category, priced in the account currency) and auto-advances — it
-- carries its `next_node_key` inside config JSONB like send_message.
--
-- Idempotent — drops & re-adds the CHECK with the widened value set.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end',
    -- Booking domain (migration 034):
    'pick_date',
    'check_availability',
    'create_reservation',
    -- Menu (migration 036):
    'show_menu'
  ));
