/**
 * Type definitions for the Flows runtime.
 *
 * These mirror the Supabase schema added in migration 010 (`flows`,
 * `flow_nodes`, `flow_runs`, `flow_run_events`) plus the discriminated
 * unions the engine uses to typecheck node configs.
 *
 * Schema invariants enforced here that the DB CHECK constraints don't:
 *   - Each node_type maps to one config shape — adding a new node_type
 *     requires adding the matching config interface AND extending
 *     `FlowNodeConfig` so the engine's exhaustiveness checks light up.
 *   - Edges live INSIDE the config (each button row / list row carries
 *     `next_node_key`). The DB schema doesn't model this — the
 *     validator (PR #3) catches missing or orphan edges at save time.
 *
 * `next_node_key` is the stable string id stored in `flow_nodes.node_key`,
 * not a UUID, so flows can be cloned / templated without rewriting
 * references in JSONB.
 */

import type { ReservationStatus } from "@/types";

// ============================================================
// Node configs (discriminated union by node_type)
// ============================================================

export interface StartNodeConfig {
  /** Stable node_key of the first real node to advance to. */
  next_node_key: string;
}

export interface SendMessageNodeConfig {
  /** Plain text sent to the customer; can interpolate {{vars.X}}. */
  text: string;
  /** Auto-advance target after the message lands at Meta. */
  next_node_key: string;
}

export interface SendButtonsNodeConfig {
  text: string;
  /** Optional header / footer lines around the buttons. */
  header_text?: string;
  footer_text?: string;
  /**
   * Optional var to store the tapped button's reply_id under. Lets a
   * button choice (e.g. party size) feed downstream nodes without a
   * free-text collect step. Omit to only route, not capture.
   */
  capture_var?: string;
  /** 1-3 buttons; Meta cap enforced in meta-api validation. */
  buttons: Array<{
    /** Stable id sent back by Meta when this button is tapped. */
    reply_id: string;
    /** Visible label (≤ 20 chars per Meta). */
    title: string;
    /** node_key the runner advances to when this button is tapped. */
    next_node_key: string;
  }>;
}

export interface SendListNodeConfig {
  text: string;
  /** Label of the tap-to-expand button on the message bubble. */
  button_label: string;
  header_text?: string;
  footer_text?: string;
  /** Optional var to store the tapped row's reply_id under (see
   *  SendButtonsNodeConfig.capture_var). */
  capture_var?: string;
  /** 1-10 rows TOTAL across sections; cap enforced in meta-api. */
  sections: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
}

/**
 * Sends a single image / video / document via WhatsApp, then
 * auto-advances. The media file is uploaded to the `flow-media`
 * Supabase Storage bucket by the builder; `media_url` is the public
 * URL Meta fetches at send time.
 *
 * Why one node with a `media_type` discriminator (rather than three
 * separate node types): Meta's send-side payload differs only in the
 * top-level key (`image` / `video` / `document`) and the
 * filename-on-document quirk. Modeling three node types would triple
 * the builder forms, engine cases, and add-menu entries for no
 * meaningful behavioural difference.
 */
export interface SendMediaNodeConfig {
  media_type: "image" | "video" | "document";
  /** Public URL Meta will fetch. Uploaded via the builder's file picker. */
  media_url: string;
  /** Optional caption shown under the media (Meta caps at 1024 chars). */
  caption?: string;
  /**
   * Filename shown in the recipient's chat. Documents only — Meta
   * ignores it for image/video. Defaults to the file's original name
   * at upload time; the user can edit it.
   */
  filename?: string;
  /** Auto-advance target after the send lands at Meta. */
  next_node_key: string;
}

export interface HandoffNodeConfig {
  /** Optional internal note written to flow_run_events.payload.note. */
  note?: string;
  /**
   * Optional agent user_id to assign on the conversation when this
   * node fires. Leave unset to flip the status without assignment.
   */
  assign_to?: string;
}

/**
 * Captures the customer's next free-text reply into
 * `flow_runs.vars[var_key]`, then advances.
 *
 * v1.5 ships without runtime validation (`validation` is accepted on
 * the config for forward compat but ignored by the runner); the
 * builder still surfaces the field so users can author flows that
 * v2 will start enforcing.
 */
export interface CollectInputNodeConfig {
  /** Prompt text sent to the customer before they reply. */
  prompt_text: string;
  /**
   * Key under which to store the captured text in
   * `flow_runs.vars`. Stable identifier — used by downstream
   * `condition` nodes and `handoff` notes via interpolation.
   */
  var_key: string;
  /**
   * Reserved for v2. Accepted on the config but ignored by the v1.5
   * runner — captures any non-empty text.
   */
  validation?: "any" | "email" | "phone" | "regex";
  /** Used only when `validation === 'regex'`. */
  regex?: string;
  /** Node to advance to after capture. */
  next_node_key: string;
}

export type ConditionOperator =
  | "equals"
  | "contains"
  | "present"
  | "absent";

export type ConditionSubject = "var" | "tag" | "contact_field";

/**
 * Routes the run based on a predicate over the contact's tags,
 * profile fields, or stored vars. Always auto-advances — no Meta
 * call, no customer-side input.
 */
export interface ConditionNodeConfig {
  subject: ConditionSubject;
  /**
   * For `var`: the key in flow_runs.vars.
   * For `tag`: the tag UUID (matched against contact_tags).
   * For `contact_field`: one of 'name' | 'email' | 'phone' | 'company'.
   */
  subject_key: string;
  operator: ConditionOperator;
  /** Compared against `subject` for `equals`/`contains`. Ignored for `present`/`absent`. */
  value?: string;
  /** Node to advance to when the predicate evaluates true. */
  true_next: string;
  /** Node to advance to when it evaluates false. */
  false_next: string;
}

export interface SetTagNodeConfig {
  mode: "add" | "remove";
  /** Tag UUID. The builder picks from the user's existing tags. */
  tag_id: string;
  next_node_key: string;
}

// ============================================================
// Booking nodes (migration 034) — adapters that expose the booking
// domain (availability + reservations) as composable flow steps.
// ============================================================

/**
 * Offers the next open booking days as buttons, scanning forward from
 * today and skipping any day with no bookable windows (resolved from
 * booking_slots + booking_exceptions). Captures the tapped ISO date
 * into a var, then advances. The reply_id of each button IS the ISO
 * date, so the runner stores it directly.
 *
 * Today is only offered when it still has time left (a window ending
 * after the current clock time). If no open day is found within the
 * search horizon the run routes to `no_dates_next`.
 *
 * Dates are resolved in the account's booking timezone
 * (booking_settings.timezone) — not the server's — so they match what
 * the restaurant sees.
 *
 * `options` / `skip_closed` are retained for backward compatibility
 * with older saved flows but are no longer used by the runner (closed
 * days are always skipped).
 */
export interface PickDateNodeConfig {
  /** Prompt body (e.g. "Which day would you like to book?"). */
  text: string;
  header_text?: string;
  footer_text?: string;
  /** How many open days to offer as buttons (1–3). Defaults to 2. */
  days_to_offer?: number;
  /** @deprecated No longer used — closed days are always skipped. */
  options?: Array<"today" | "tomorrow">;
  /** @deprecated No longer used — closed days are always skipped. */
  skip_closed?: boolean;
  /** Var to store the chosen ISO date ("YYYY-MM-DD"). */
  output_var: string;
  /** Advance target after a date is picked. */
  next_node_key: string;
  /**
   * Optional advance target when no open day is found within the
   * horizon. When unset, the runner sends a built-in apology and ends
   * the run — so this rare case needs no wiring.
   */
  no_dates_next?: string;
}

/**
 * Resolves the open time windows for the date held in `date_var`,
 * enumerates selectable start times at `slot_interval_minutes`, and
 * sends them as an interactive list. The reply_id of each row is the
 * "HH:MM" start time, captured into `output_var` on tap.
 *
 * Times that have already passed are filtered out when the chosen
 * date is "today" in the booking timezone. When the date is closed or
 * has no remaining times, the run routes to `unavailable_next`
 * instead of suspending.
 */
export interface CheckAvailabilityNodeConfig {
  /** Var holding the ISO date to look up (set by pick_date earlier). */
  date_var: string;
  /** Prompt body shown above the list. Supports {{vars.X}}. */
  text: string;
  /** Tap-to-expand label on the list bubble (e.g. "View times"). */
  button_label: string;
  header_text?: string;
  footer_text?: string;
  /** Minutes between offered start times within each open window. */
  slot_interval_minutes: number;
  /** Max times to offer. Capped at WhatsApp's 10-row list limit. */
  max_options?: number;
  /** Var to store the chosen start time ("HH:MM"). */
  output_var: string;
  /** Advance target after a time is picked. */
  next_node_key: string;
  /**
   * Optional advance target when the day has no bookable times left.
   * When unset, the runner sends a built-in apology and ends the run.
   */
  unavailable_next?: string;
}

/**
 * Writes the reservation. Resolves (or creates) a guest from the
 * conversation's WhatsApp contact, re-validates the slot against live
 * availability (race-safe — the time may have filled since the list
 * was shown), then inserts the booking with no table assigned.
 *
 * Auto-advances to `success_next` on success or `error_next` when the
 * booking can't be made (closed window, invalid party size, DB error).
 * Both branches are optional: when unset, the runner sends a built-in
 * confirmation (success) or apology (error) and ends the run — so the
 * block works on its own with no wiring. Stores the new reservation id
 * in `vars.reservation_id` for use in a downstream confirmation message.
 */
export interface CreateReservationNodeConfig {
  /** Var holding the ISO date. */
  date_var: string;
  /** Var holding the start time ("HH:MM"). */
  time_var: string;
  /** Var holding the party size (parsed to an integer). */
  party_size_var: string;
  /** Status for the created reservation (default 'pending'). */
  reservation_status: ReservationStatus;
  /** Optional var whose value seeds the guest name on first creation. */
  guest_name_var?: string;
  /** Optional notes stored on the reservation. Supports {{vars.X}}. */
  notes_template?: string;
  /** Optional advance target on a successful booking (built-in
   *  confirmation + end when unset). */
  success_next?: string;
  /** Optional advance target when the booking can't be made (built-in
   *  apology + end when unset). */
  error_next?: string;
}

// ============================================================
// Menu node (migration 036)
// ============================================================

/**
 * Sends the account's menu as a text message, then auto-advances like
 * send_message. The runner reads available `menu_items`, groups them
 * by category, prices them in the account currency, and renders a
 * WhatsApp text block (see `lib/menu/render.ts`). No customer input —
 * it's a one-shot display step.
 *
 * When the menu is empty, the runner sends a short "menu unavailable"
 * line and still advances, so the flow never stalls.
 */
export interface ShowMenuNodeConfig {
  /** Optional intro line shown above the menu (e.g. "Here's our menu:"). */
  intro_text?: string;
  /** Show prices next to each item. Default true. */
  include_prices?: boolean;
  /** Show item descriptions. Default true. */
  include_descriptions?: boolean;
  /** Auto-advance target after the message lands at Meta. */
  next_node_key: string;
}

// Terminal nodes carry no config — they just stop the run.
export type EndNodeConfig = Record<string, never>;

/**
 * Total union — every concrete node_type the v1 engine understands.
 * Add new node types here and the engine's switch will flag missing
 * cases via TypeScript's exhaustiveness check.
 *
 * v1.5+ additions (collect_input, condition, set_tag, http_fetch) will
 * extend this union — out-of-scope for the v1 engine PR.
 */
export type FlowNodeConfig =
  | { node_type: "start"; config: StartNodeConfig }
  | { node_type: "send_message"; config: SendMessageNodeConfig }
  | { node_type: "send_buttons"; config: SendButtonsNodeConfig }
  | { node_type: "send_list"; config: SendListNodeConfig }
  | { node_type: "send_media"; config: SendMediaNodeConfig }
  | { node_type: "collect_input"; config: CollectInputNodeConfig }
  | { node_type: "condition"; config: ConditionNodeConfig }
  | { node_type: "set_tag"; config: SetTagNodeConfig }
  | { node_type: "pick_date"; config: PickDateNodeConfig }
  | { node_type: "check_availability"; config: CheckAvailabilityNodeConfig }
  | { node_type: "create_reservation"; config: CreateReservationNodeConfig }
  | { node_type: "show_menu"; config: ShowMenuNodeConfig }
  | { node_type: "handoff"; config: HandoffNodeConfig }
  | { node_type: "end"; config: EndNodeConfig };

export type FlowNodeType = FlowNodeConfig["node_type"];

// ============================================================
// Triggers (matches `flows.trigger_type` + `trigger_config`)
// ============================================================

export interface KeywordTriggerConfig {
  /** One or more keywords. Match is case-insensitive by default. */
  keywords: string[];
  match_type?: "exact" | "contains";
  case_sensitive?: boolean;
}

// No knobs in v1 — the trigger has a single semantic. Kept as a type
// alias (not an empty interface) for forward compat without tripping
// the no-empty-object-type lint rule.
export type FirstInboundTriggerConfig = Record<string, never>;

export type FlowTriggerConfig =
  | { trigger_type: "keyword"; config: KeywordTriggerConfig }
  | { trigger_type: "first_inbound_message"; config: FirstInboundTriggerConfig }
  | { trigger_type: "manual"; config: Record<string, never> };

// ============================================================
// DB-row shapes (read by the engine via supabaseAdmin)
// ============================================================

export interface FlowRow {
  id: string;
  /** Account tenancy (NOT NULL post-017). The engine looks up active
   *  flows for inbound dispatch using this field. */
  account_id: string;
  /** Author. Used as a default sender-of-record on engine sends and
   *  preserved on flow_runs for log/audit display. */
  user_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | FirstInboundTriggerConfig | Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: FlowFallbackPolicy;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowNodeRow {
  id: string;
  flow_id: string;
  node_key: string;
  node_type: FlowNodeType;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
  created_at: string;
}

export interface FlowRunRow {
  id: string;
  flow_id: string;
  /** Tenancy. Matches flows.account_id; NOT NULL post-017. */
  account_id: string;
  /** Audit. Matches the parent flow.user_id. */
  user_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  status:
    | "active"
    | "completed"
    | "handed_off"
    | "timed_out"
    | "paused_by_agent"
    | "failed";
  current_node_key: string | null;
  last_prompt_message_id: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

// ============================================================
// Fallback policy (matches flows.fallback_policy JSONB)
// ============================================================

export interface FlowFallbackPolicy {
  /** What to do when the customer reply doesn't match any option. */
  on_unknown_reply: "reprompt" | "handoff" | "ignore";
  /** Max reprompts before applying `on_exhaust`. */
  max_reprompts: number;
  /** Stale-run sweep cutoff. */
  on_timeout_hours: number;
  /** What to do once max_reprompts has been hit. */
  on_exhaust: "handoff" | "end";
}

export const DEFAULT_FALLBACK_POLICY: FlowFallbackPolicy = {
  on_unknown_reply: "reprompt",
  max_reprompts: 2,
  on_timeout_hours: 24,
  on_exhaust: "handoff",
};

// ============================================================
// Engine input — what `dispatchInboundToFlows` accepts
// ============================================================

/**
 * Normalised view of an inbound message that the runner needs. The
 * webhook lifts this out of the raw Meta payload before invoking the
 * runner; keeps the runner free of any WhatsApp-API specifics.
 */
export type ParsedInbound =
  | {
      kind: "text";
      /** The user's typed message body. */
      text: string;
      /** Meta's `messages[0].id` — used for idempotency. */
      meta_message_id: string;
    }
  | {
      kind: "interactive_reply";
      /** The reply_id of the tapped button or list row. */
      reply_id: string;
      /** The visible title of the tapped option (for logging). */
      reply_title: string;
      meta_message_id: string;
    };

export interface DispatchInboundInput {
  /** Account tenancy key. Drives the lookup of active flows and the
   *  idempotency check for previously-seen inbound message_ids. */
  accountId: string;
  /** Sender-of-record for the bot's outbound prompts on engine
   *  sends. Set by the webhook to the WhatsApp config owner. */
  userId: string;
  contactId: string;
  conversationId: string;
  message: ParsedInbound;
}

export interface DispatchInboundResult {
  /**
   * True iff the runner handled the message — it either advanced an
   * existing run or started a new one matching a flow trigger.
   * Webhook uses this to decide whether to also fire automations.
   */
  consumed: boolean;
  /** For diagnostics / logging — null when not consumed. */
  flow_run_id?: string;
  /** For diagnostics. */
  outcome?:
    | "advanced"
    | "started"
    | "completed"
    | "handed_off"
    | "fallback_fired"
    | "duplicate_inbound_ignored"
    | "no_match";
}

// ============================================================
// Helpers — exhaustiveness assertions
// ============================================================

/**
 * Throws a typed compile-time error if the switch over a discriminated
 * union forgets a case. Used in the engine's node-type switch.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled node type: ${JSON.stringify(x)}`);
}
