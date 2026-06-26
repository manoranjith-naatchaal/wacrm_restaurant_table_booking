/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { supabaseAdmin } from "./admin-client";
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import {
  addDaysIso,
  createReservationFromFlow,
  dateButtonLabel,
  DEFAULT_BOOKING_TIMEZONE,
  enumerateStartTimes,
  formatTime12,
  getAccountTimezone,
  getZonedNow,
  hasOpenTimeRemaining,
  shortDayLabel,
} from "./booking";
import { getAccountAvailability } from "@/lib/reservations/booking-checks";
import {
  type CheckAvailabilityNodeConfig,
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type CreateReservationNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunRow,
  type ParsedInbound,
  type PickDateNodeConfig,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMediaNodeConfig,
  type SendMessageNodeConfig,
  type SetTagNodeConfig,
  type ShowMenuNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";
import { renderMenuText } from "@/lib/menu/render";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import type { MenuItem } from "@/types";

/** Reserved var keys the booking nodes use to remember what they
 *  offered, so the reply handler can validate the tapped option. */
const OFFERED_DATES_KEY = "__pick_date_options";
const OFFERED_TIMES_KEY = "__avail_options";

/** Coerce a stored var to a string ("" when absent). */
function strVar(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "send_media" ||
    node_type === "condition" ||
    node_type === "set_tag" ||
    // Composes a menu message then advances like send_message.
    node_type === "show_menu" ||
    // Action node — does its DB work then routes success/error.
    node_type === "create_reservation"
  );
}

/** Nodes that send a prompt and suspend awaiting a customer reply.
 *  `pick_date`/`check_availability` usually suspend, but may instead
 *  route straight to a branch (no open days / no times) — classified
 *  as suspending for the inbox's "awaiting reply" display. */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input" ||
    node_type === "pick_date" ||
    node_type === "check_availability"
  );
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return node_type === "handoff" || node_type === "end";
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>;

async function loadActiveRunForContact(
  db: AdminClient,
  accountId: string,
  contactId: string,
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` was
  // rebuilt in migration 017 over `(account_id, contact_id)` — so
  // "two active runs for one contact in one account" is impossible
  // by design. But a future migration glitch or manual SQL could
  // create one, and .maybeSingle() throws on >1 row — which would
  // kill dispatch for that contact's webhook entirely. .limit(1) is
  // forgiving: pick the newest, let the cron sweep clean up the
  // stale one.
  const { data, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[flows] loadActiveRunForContact error:", error.message);
    return null;
  }
  const rows = (data as FlowRunRow[] | null) ?? [];
  return rows[0] ?? null;
}

async function loadFlow(
  db: AdminClient,
  flowId: string,
): Promise<FlowRow | null> {
  const { data, error } = await db
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .maybeSingle();
  if (error) {
    console.error("[flows] loadFlow error:", error.message);
    return null;
  }
  return (data as FlowRow | null) ?? null;
}

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
async function loadAllNodes(
  db: AdminClient,
  flowId: string,
): Promise<Map<string, FlowNodeRow>> {
  const { data, error } = await db
    .from("flow_nodes")
    .select("*")
    .eq("flow_id", flowId);
  if (error) {
    console.error("[flows] loadAllNodes error:", error.message);
    return new Map();
  }
  const map = new Map<string, FlowNodeRow>();
  for (const row of (data ?? []) as FlowNodeRow[]) {
    map.set(row.node_key, row);
  }
  return map;
}

async function logEvent(
  db: AdminClient,
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("flow_run_events").insert({
    flow_run_id: flowRunId,
    event_type,
    node_key,
    payload,
  });
  if (error) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", error.message);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  db: AdminClient,
  accountId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact in this account (active +
  // historical). Bounded by how many flows the customer has been
  // through — small.
  const { data: runs } = await db
    .from("flow_runs")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId);
  if (!runs?.length) return false;
  const runIds = runs.map((r) => (r as { id: string }).id);

  const { count } = await db
    .from("flow_run_events")
    .select("id", { count: "exact", head: true })
    .in("flow_run_id", runIds)
    .eq("event_type", "reply_received")
    .filter("payload->>meta_message_id", "eq", metaMessageId);
  return (count ?? 0) > 0;
}

async function findEntryFlow(
  db: AdminClient,
  accountId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== "text") return null;

  // Pull all active flows for this account. Active set is bounded
  // (the builder discourages double-trigger overlap; partial index
  // makes the lookup index-supported).
  const { data: flows, error } = await db
    .from("flows")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !flows) return null;

  const typed = flows as FlowRow[];
  for (const flow of typed) {
    if (flow.trigger_type === "keyword") {
      if (matchesKeywordTrigger(
        message.text,
        flow.trigger_config as KeywordTriggerConfig,
      )) {
        return flow;
      }
    } else if (flow.trigger_type === "first_inbound_message" && isFirstInbound) {
      return flow;
    }
    // 'manual' triggers do not auto-start from inbound messages.
  }
  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: interpolateVars(cfg.text, run.vars),
    headerText: cfg.header_text
      ? interpolateVars(cfg.header_text, run.vars)
      : undefined,
    footerText: cfg.footer_text
      ? interpolateVars(cfg.footer_text, run.vars)
      : undefined,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  // Look up our internal message id so we can stash it on the run.
  // Cheap — indexed on `messages.message_id`.
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

async function sendListAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: interpolateVars(cfg.text, run.vars),
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text
      ? interpolateVars(cfg.header_text, run.vars)
      : undefined,
    footerText: cfg.footer_text
      ? interpolateVars(cfg.footer_text, run.vars)
      : undefined,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsapp_message_id)
    .maybeSingle();
  await db
    .from("flow_runs")
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  return { outcome: "advanced", node_key: node.node_key };
}

/**
 * Look up the internal message id for a just-sent prompt and persist
 * it (so the inbox can quote it) alongside a vars patch — used by the
 * booking nodes to remember the options they offered.
 */
async function persistOfferedAndPrompt(
  db: AdminClient,
  run: FlowRunRow,
  varsPatch: Record<string, unknown>,
  whatsappMessageId: string,
): Promise<void> {
  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("message_id", whatsappMessageId)
    .maybeSingle();
  const newVars = { ...run.vars, ...varsPatch };
  await db
    .from("flow_runs")
    .update({
      vars: newVars,
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq("id", run.id);
  // Mirror in-memory so the reply handler (which reads run.vars) sees
  // the offered options without a re-SELECT.
  run.vars = newVars;
}

/**
 * Result of a booking node executor: suspend awaiting a tap, route to
 * a branch (no open days / no times / booking result), or fail the run.
 */
type BookingExec =
  | { kind: "suspend" }
  | { kind: "advance"; next: string }
  // A terminal message was already sent (e.g. "no open days") — end the
  // run as completed rather than failed.
  | { kind: "complete" }
  | { kind: "fail"; reason: string };

/** Send a one-off message and swallow send errors (logged) — used for
 *  the booking nodes' built-in "nothing available" replies. */
async function sendBuiltinNotice(
  db: AdminClient,
  run: FlowRunRow,
  nodeKey: string,
  reason: string,
  text: string,
): Promise<void> {
  try {
    const { whatsapp_message_id } = await engineSendText({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      text,
    });
    await logEvent(db, run.id, "message_sent", nodeKey, {
      reason,
      whatsapp_message_id,
    });
  } catch (err) {
    await logEvent(db, run.id, "error", nodeKey, {
      reason: `${reason}_send_failed`,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Build the menu text for a `show_menu` node: reads the account
 * currency + available items, renders the grouped block, and falls
 * back to a short notice when the menu is empty (so the flow advances
 * instead of sending a blank message). DB errors degrade to the
 * fallback rather than throwing — the surrounding case still advances.
 */
async function composeMenuText(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ShowMenuNodeConfig,
): Promise<string> {
  let currency = DEFAULT_CURRENCY;
  try {
    const { data: account } = await db
      .from("accounts")
      .select("default_currency")
      .eq("id", run.account_id)
      .maybeSingle();
    if (account?.default_currency) currency = account.default_currency;
  } catch {
    // Keep the default currency.
  }

  let items: MenuItem[] = [];
  try {
    const { data } = await db
      .from("menu_items")
      .select("*")
      .eq("account_id", run.account_id)
      .eq("is_available", true);
    items = (data as MenuItem[] | null) ?? [];
  } catch {
    items = [];
  }

  const text = renderMenuText(items, {
    currency,
    introText: cfg.intro_text
      ? interpolateVars(cfg.intro_text, run.vars)
      : undefined,
    includePrices: cfg.include_prices,
    includeDescriptions: cfg.include_descriptions,
  });
  return (
    text || "Our menu isn't available right now. Please check back soon."
  );
}

/** How far ahead pick_date scans for open days before giving up. */
const PICK_DATE_HORIZON_DAYS = 30;

/**
 * `pick_date` — offer the next open booking days as buttons, scanning
 * forward from today (in the account timezone) and skipping any closed
 * day. Today is only offered when it still has bookable time left. The
 * button reply_id IS the ISO date, remembered in vars for validation.
 * Routes to `no_dates_next` when no open day is found within the
 * horizon.
 */
async function executePickDate(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<BookingExec> {
  const cfg = node.config as unknown as PickDateNodeConfig;
  let tz: string;
  try {
    tz = await getAccountTimezone(db, run.account_id);
  } catch {
    tz = DEFAULT_BOOKING_TIMEZONE;
  }
  const now = getZonedNow(tz);
  const todayIso = now.dateIso;
  const daysToOffer = Math.min(
    Math.max(cfg.days_to_offer && cfg.days_to_offer > 0 ? cfg.days_to_offer : 2, 1),
    3,
  );

  const found: Array<{ iso: string; label: string }> = [];
  for (
    let i = 0;
    i < PICK_DATE_HORIZON_DAYS && found.length < daysToOffer;
    i++
  ) {
    const iso = addDaysIso(todayIso, i);
    let closed = false;
    let windows: Array<{ start: string; end: string }> = [];
    try {
      const avail = await getAccountAvailability(db, run.account_id, iso);
      closed = avail.closed;
      windows = avail.windows;
    } catch {
      // On a lookup error, skip the day rather than offering a date we
      // can't show times for.
      continue;
    }
    if (closed || windows.length === 0) continue;
    // Today only counts if there's still bookable time ahead of now.
    if (iso === todayIso && !hasOpenTimeRemaining(windows, now.time)) continue;
    found.push({ iso, label: dateButtonLabel(iso, todayIso) });
  }

  if (found.length === 0) {
    if (cfg.no_dates_next) return { kind: "advance", next: cfg.no_dates_next };
    await sendBuiltinNotice(
      db,
      run,
      node.node_key,
      "no_open_days",
      "Sorry, we don't have any open days available right now. Please try again later.",
    );
    return { kind: "complete" };
  }

  let waId: string;
  try {
    const r = await engineSendInteractiveButtons({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      bodyText: interpolateVars(cfg.text, run.vars),
      headerText: cfg.header_text,
      footerText: cfg.footer_text,
      buttons: found.map((f) => ({ id: f.iso, title: f.label })),
    });
    waId = r.whatsapp_message_id;
  } catch (err) {
    return {
      kind: "fail",
      reason: err instanceof Error ? err.message : "pick_date_send_failed",
    };
  }
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "pick_date",
    whatsapp_message_id: waId,
    days: found.length,
  });
  await persistOfferedAndPrompt(
    db,
    run,
    { [OFFERED_DATES_KEY]: found.map((f) => f.iso) },
    waId,
  );
  return { kind: "suspend" };
}

/**
 * `check_availability` — resolve open times for the chosen date and
 * send them as a list. Routes to `unavailable_next` when the date is
 * closed or has no remaining times.
 */
async function executeCheckAvailability(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<BookingExec> {
  const cfg = node.config as unknown as CheckAvailabilityNodeConfig;
  // Routes to the configured branch, or sends a built-in apology and
  // ends the run when no branch is wired.
  const noTimes = async (): Promise<BookingExec> => {
    if (cfg.unavailable_next) {
      return { kind: "advance", next: cfg.unavailable_next };
    }
    await sendBuiltinNotice(
      db,
      run,
      node.node_key,
      "no_times",
      "Sorry, there are no available times for that day. Reply to start again.",
    );
    return { kind: "complete" };
  };

  const dateIso = strVar(run.vars[cfg.date_var]);
  if (!dateIso) return noTimes();

  let tz: string;
  try {
    tz = await getAccountTimezone(db, run.account_id);
  } catch {
    tz = DEFAULT_BOOKING_TIMEZONE;
  }

  let windows: Array<{ start: string; end: string }>;
  try {
    const avail = await getAccountAvailability(db, run.account_id, dateIso);
    if (avail.closed || avail.windows.length === 0) {
      return noTimes();
    }
    windows = avail.windows;
  } catch (err) {
    return {
      kind: "fail",
      reason: err instanceof Error ? err.message : "availability_failed",
    };
  }

  // Hide already-passed times when the chosen date is today.
  const now = getZonedNow(tz);
  const notBefore = dateIso === now.dateIso ? now.time : undefined;
  const cap = Math.min(
    cfg.max_options && cfg.max_options > 0 ? cfg.max_options : 10,
    10,
  );
  const times = enumerateStartTimes(
    windows,
    cfg.slot_interval_minutes,
    notBefore,
  ).slice(0, cap);
  if (times.length === 0) {
    return noTimes();
  }

  let waId: string;
  try {
    const r = await engineSendInteractiveList({
      accountId: run.account_id,
      userId: run.user_id,
      conversationId: run.conversation_id!,
      contactId: run.contact_id!,
      bodyText: interpolateVars(cfg.text, run.vars),
      buttonLabel: cfg.button_label || "View times",
      headerText: cfg.header_text,
      footerText: cfg.footer_text,
      sections: [
        {
          title: "Available times",
          rows: times.map((t) => ({ id: t, title: formatTime12(t) })),
        },
      ],
    });
    waId = r.whatsapp_message_id;
  } catch (err) {
    return {
      kind: "fail",
      reason:
        err instanceof Error ? err.message : "check_availability_send_failed",
    };
  }
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "check_availability",
    whatsapp_message_id: waId,
    options: times.length,
  });
  await persistOfferedAndPrompt(db, run, { [OFFERED_TIMES_KEY]: times }, waId);
  return { kind: "suspend" };
}

/**
 * `create_reservation` — write the booking and route success/error.
 * Always auto-advances (never suspends); a booking failure routes to
 * `error_next` rather than failing the whole run.
 */
async function executeCreateReservation(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<BookingExec> {
  const cfg = node.config as unknown as CreateReservationNodeConfig;
  const dateIso = strVar(run.vars[cfg.date_var]);
  const startTime = strVar(run.vars[cfg.time_var]);
  const partySize = parseInt(strVar(run.vars[cfg.party_size_var]), 10);
  const guestName = cfg.guest_name_var
    ? strVar(run.vars[cfg.guest_name_var])
    : undefined;
  const notes = cfg.notes_template
    ? interpolateVars(cfg.notes_template, run.vars)
    : null;

  const result = await createReservationFromFlow(db, {
    accountId: run.account_id,
    userId: run.user_id,
    contactId: run.contact_id!,
    reservationDate: dateIso,
    startTime,
    partySize,
    status: cfg.reservation_status || "pending",
    guestName: guestName || undefined,
    notes,
  });

  if (!result.ok) {
    await logEvent(db, run.id, "error", node.node_key, {
      node_type: "create_reservation",
      reason: "booking_failed",
      detail: result.error,
    });
    if (cfg.error_next) return { kind: "advance", next: cfg.error_next };
    await sendBuiltinNotice(
      db,
      run,
      node.node_key,
      "booking_failed",
      "Sorry, we couldn't complete that booking. Please reply to try again.",
    );
    return { kind: "complete" };
  }

  const newVars = { ...run.vars, reservation_id: result.reservationId };
  await db.from("flow_runs").update({ vars: newVars }).eq("id", run.id);
  run.vars = newVars;
  await logEvent(db, run.id, "node_entered", node.node_key, {
    node_type: "create_reservation",
    reservation_id: result.reservationId,
  });
  if (cfg.success_next) return { kind: "advance", next: cfg.success_next };
  // No confirmation node wired — send a built-in confirmation so the
  // block is fully self-contained.
  const guests = Number.isFinite(partySize) && partySize > 0 ? partySize : null;
  const parts = [
    "You're booked",
    dateIso ? `for ${shortDayLabel(dateIso)}` : null,
    startTime ? `at ${formatTime12(startTime)}` : null,
    guests ? `for ${guests} ${guests === 1 ? "guest" : "guests"}` : null,
  ].filter(Boolean);
  await sendBuiltinNotice(
    db,
    run,
    node.node_key,
    "booking_confirmed",
    `${parts.join(" ")}. See you then!`,
  );
  return { kind: "complete" };
}

async function executeHandoff(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convUpdate: Record<string, unknown> = {
    status: "pending",
    updated_at: new Date().toISOString(),
  };
  if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
  if (run.conversation_id) {
    await db
      .from("conversations")
      .update(convUpdate)
      .eq("id", run.conversation_id);
  }
  await logEvent(db, run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(db, run.id, "handed_off", "handoff_node");
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const { count } = await db
      .from("contact_tags")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", run.contact_id!)
      .eq("tag_id", cfg.subject_key);
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data } = await db
      .from("contacts")
      .select(cfg.subject_key)
      .eq("id", run.contact_id!)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Capture a booking node's tapped option (ISO date / "HH:MM" time)
 * into a var and reset the reprompt count. Mirrors the collect_input
 * capture: writes vars, mirrors in-memory, and returns the node's
 * single advance target (or null on a DB error).
 */
async function captureBookingVar(
  db: AdminClient,
  run: FlowRunRow,
  varKey: string,
  value: string,
  nextKey: string,
): Promise<string | null> {
  const newVars = { ...run.vars, [varKey]: value };
  const { error } = await db
    .from("flow_runs")
    .update({ vars: newVars, reprompt_count: 0 })
    .eq("id", run.id);
  if (error) return null;
  run.vars = newVars;
  run.reprompt_count = 0;
  await logEvent(db, run.id, "node_entered", run.current_node_key, {
    captured_key: varKey,
  });
  return nextKey;
}

async function endRun(
  db: AdminClient,
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await db
    .from("flow_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("id", runId);
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

async function advanceFromNodeKey(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  let currentKey: string | null = startNodeKey;
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(db, run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(db, run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(db, run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "show_menu") {
      const cfg = node.config as unknown as ShowMenuNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: await composeMenuText(db, run, cfg),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "show_menu",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "show_menu_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "show_menu_send_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_media") {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendMedia({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          kind: cfg.media_type,
          link: cfg.media_url,
          caption: cfg.caption
            ? interpolateVars(cfg.caption, run.vars)
            : undefined,
          filename: cfg.filename,
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "send_media",
          media_type: cfg.media_type,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "send_media_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "send_media_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(db, run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const { data: msg } = await db
          .from("messages")
          .select("id")
          .eq("message_id", whatsapp_message_id)
          .maybeSingle();
        await db
          .from("flow_runs")
          .update({
            last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
          })
          .eq("id", run.id);
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(db, run, cfg))
          ? "true"
          : "false";
      } catch (err) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === "add") {
          await db
            .from("contact_tags")
            .upsert(
              { contact_id: run.contact_id!, tag_id: cfg.tag_id },
              { onConflict: "contact_id,tag_id" },
            );
        } else {
          await db
            .from("contact_tags")
            .delete()
            .eq("contact_id", run.contact_id!)
            .eq("tag_id", cfg.tag_id);
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      await sendButtonsAndSuspend(db, run, node);
      // Persist the new current_node_key via optimistic UPDATE.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      await sendListAndSuspend(db, run, node);
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (
      node.node_type === "pick_date" ||
      node.node_type === "check_availability"
    ) {
      const r: BookingExec =
        node.node_type === "pick_date"
          ? await executePickDate(db, run, node)
          : await executeCheckAvailability(db, run, node);
      if (r.kind === "fail") {
        await endRun(db, run.id, "failed", `${node.node_type}_failed`);
        return { outcome: "completed" };
      }
      if (r.kind === "complete") {
        // A built-in "nothing available" notice was already sent.
        await endRun(db, run.id, "completed", `${node.node_type}_no_options`);
        return { outcome: "completed" };
      }
      if (r.kind === "advance") {
        // Routed to a branch (no open days / no times) without
        // suspending — keep walking the graph.
        currentKey = r.next;
        continue;
      }
      // Suspended awaiting the customer's tap — persist the pointer.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "create_reservation") {
      const r = await executeCreateReservation(db, run, node);
      if (r.kind === "fail") {
        await endRun(db, run.id, "failed", "create_reservation_failed");
        return { outcome: "completed" };
      }
      if (r.kind === "complete") {
        // Built-in confirmation/apology already sent — end the run.
        await endRun(db, run.id, "completed", "create_reservation_done");
        return { outcome: "completed" };
      }
      // Otherwise route to the wired success/error branch.
      currentKey = r.kind === "advance" ? r.next : null;
      continue;
    }
    if (node.node_type === "handoff") {
      await executeHandoff(db, run, node);
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(db, run.id, "completed", node.node_key);
      await endRun(db, run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(db, run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(db, run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(db, run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(db, run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 */
async function advanceCurrentNodeKey(
  db: AdminClient,
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  // PostgREST: when expectedOldKey is null we can't `.eq` (would match
  // any row); use `.is('current_node_key', null)` instead.
  let q = db
    .from("flow_runs")
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "active");
  if (expectedOldKey === null) {
    q = q.is("current_node_key", null);
  } else {
    q = q.eq("current_node_key", expectedOldKey);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[flows] advanceCurrentNodeKey error:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        db,
        input.accountId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
      // One SELECT for the whole flow's nodes — advance loop is now
      // in-memory. See loadAllNodes.
      const nodes = await loadAllNodes(db, activeRun.flow_id);
      return handleReplyForActiveRun(db, activeRun, input.message, nodes);
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      db,
      input.accountId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow || !flow.entry_node_id) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(db, flow.id);
    return startNewRun(db, flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(db, run.id, "reply_received", run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(db, run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    await endRun(db, run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
    // Optional capture: remember which option was tapped so a button /
    // list choice (e.g. party size) can feed downstream booking nodes.
    const captureVar = (currentNode.config as { capture_var?: string })
      .capture_var;
    if (
      matched &&
      captureVar &&
      /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(captureVar)
    ) {
      const newVars = { ...run.vars, [captureVar]: message.reply_id };
      const { error: capErr } = await db
        .from("flow_runs")
        .update({ vars: newVars })
        .eq("id", run.id);
      if (!capErr) {
        run.vars = newVars;
        await logEvent(db, run.id, "node_entered", currentNode.node_key, {
          captured_key: captureVar,
        });
      }
    }
  } else if (
    message.kind === "interactive_reply" &&
    currentNode.node_type === "pick_date"
  ) {
    const cfg = currentNode.config as unknown as PickDateNodeConfig;
    const offered = Array.isArray(run.vars[OFFERED_DATES_KEY])
      ? (run.vars[OFFERED_DATES_KEY] as string[])
      : [];
    if (offered.includes(message.reply_id)) {
      matched = await captureBookingVar(
        db,
        run,
        cfg.output_var,
        message.reply_id,
        cfg.next_node_key,
      );
    }
  } else if (
    message.kind === "interactive_reply" &&
    currentNode.node_type === "check_availability"
  ) {
    const cfg = currentNode.config as unknown as CheckAvailabilityNodeConfig;
    const offered = Array.isArray(run.vars[OFFERED_TIMES_KEY])
      ? (run.vars[OFFERED_TIMES_KEY] as string[])
      : [];
    if (offered.includes(message.reply_id)) {
      matched = await captureBookingVar(
        db,
        run,
        cfg.output_var,
        message.reply_id,
        cfg.next_node_key,
      );
    }
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length > 0 && cfg.var_key) {
      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      const { error: capErr } = await db
        .from("flow_runs")
        .update({
          vars: newVars,
          reprompt_count: 0,
        })
        .eq("id", run.id);
      if (!capErr) {
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(db, run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      }
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.reprompt_count !== 0) {
      const { error } = await db
        .from("flow_runs")
        .update({ reprompt_count: 0 })
        .eq("id", run.id);
      if (!error) run.reprompt_count = 0;
    }
    const outcome = await advanceFromNodeKey(db, run, matched, nodes);
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const policy = resolveFallbackPolicy(
    (await loadFlow(db, run.flow_id))?.fallback_policy,
  );
  const newReprompts = run.reprompt_count + 1;
  await db
    .from("flow_runs")
    .update({ reprompt_count: newReprompts })
    .eq("id", run.id);

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(db, run.id, "fallback_fired", run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === "send_buttons") {
      await sendButtonsAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "send_list") {
      await sendListAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === "pick_date") {
      // Re-offer the same date choices. Ignore the result: a rare
      // "no open days now" route won't re-send, leaving the prompt
      // unchanged — acceptable for a reprompt.
      await executePickDate(db, run, currentNode);
    } else if (currentNode.node_type === "check_availability") {
      await executeCheckAvailability(db, run, currentNode);
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          accountId: run.account_id,
    userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(db, run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversation_id) {
      await db
        .from("conversations")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", run.conversation_id);
    }
    await logEvent(db, run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    await endRun(db, run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(db, run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  db: AdminClient,
  flow: FlowRow,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We catch and return as
  // consumed:true (the parallel webhook handles it).
  const { data: inserted, error: insErr } = await db
    .from("flow_runs")
    .insert({
      flow_id: flow.id,
      // Tenancy: NOT NULL post-017. The partial unique index
      // `idx_one_active_run_per_contact` is over (account_id,
      // contact_id) WHERE status='active', so two accounts sharing
      // a contact phone number each run their own flows independently.
      account_id: flow.account_id,
      // Audit: preserves the flow's author on the run row for log
      // attribution.
      user_id: flow.user_id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      status: "active",
      current_node_key: flow.entry_node_id,
    })
    .select("*")
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation → another webhook is starting the run.
    const msg = insErr.message ?? "";
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", insErr.message);
    return { consumed: false, outcome: "no_match" };
  }
  const run = inserted as FlowRunRow;
  await logEvent(db, run.id, "started", flow.entry_node_id, {
    flow_id: flow.id,
    trigger_type: flow.trigger_type,
    meta_message_id: input.message.meta_message_id,
  });
  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  const { error: incErr } = await db.rpc("increment_flow_execution_count", {
    p_flow_id: flow.id,
  });
  if (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count rpc error:", incErr.message);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(db, run, flow.entry_node_id!, nodes);
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}
