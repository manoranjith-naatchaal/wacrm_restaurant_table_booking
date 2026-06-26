-- ============================================================
-- 034_flow_booking_nodes.sql — Booking-aware flow node types
--
-- Adds three node types to the flow graph so restaurants can assemble
-- a "book a table over WhatsApp" conversation in the flow builder:
--
--   - pick_date          — offers Today / Tomorrow (real dates), skips
--                           fully-closed days, captures the chosen date.
--   - check_availability  — resolves open times for the chosen date from
--                           booking_slots + booking_exceptions and sends
--                           them as a tappable list; branches when closed.
--   - create_reservation  — resolves/creates a guest from the WhatsApp
--                           contact and writes the reservation; branches
--                           on success / failure.
--
-- Edge model is unchanged — these carry their `next_node_key` (and
-- branch keys) inside config JSONB like every other node. Only the
-- CHECK constraint's allowed set changes here.
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
    'create_reservation'
  ));
