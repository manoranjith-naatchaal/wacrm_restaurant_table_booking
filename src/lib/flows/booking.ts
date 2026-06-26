/**
 * Booking helpers for the Flows engine.
 *
 * Splits into two layers:
 *   - PURE date/time math (timezone resolution, "today/tomorrow",
 *     enumerating selectable start times from open windows). No I/O —
 *     unit-tested directly.
 *   - DB-backed actions (read the account timezone, resolve/create a
 *     guest from a WhatsApp contact, write a reservation). These wrap
 *     the existing reservation domain (`checkBooking`) so the
 *     bot-created booking goes through the exact same validation as a
 *     dashboard-created one.
 *
 * The engine's booking node executors call into here so engine.ts
 * stays focused on graph-walking, not booking rules.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReservationStatus } from "@/types";
import { checkBooking, type BookingState } from "@/lib/reservations/booking-checks";

// ============================================================
// Pure date/time helpers
// ============================================================

/** Default account timezone when booking_settings has no row. */
export const DEFAULT_BOOKING_TIMEZONE = "Asia/Kolkata";

/**
 * Current date + wall-clock time in a given IANA timezone. Uses
 * Intl.formatToParts so we never depend on the server's local zone.
 * Returns `dateIso` as "YYYY-MM-DD" and `time` as "HH:MM" (24h).
 */
export function getZonedNow(
  timezone: string,
  base: Date = new Date(),
): { dateIso: string; time: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(base);
  } catch {
    // Invalid tz string → fall back to UTC rather than throwing
    // mid-conversation.
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(base);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  // Some runtimes emit "24" for midnight under hour12:false.
  if (hour === "24") hour = "00";
  return {
    dateIso: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

/** Add (or subtract) whole days to an ISO date, no timezone drift. */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "2026-06-27" → "Fri 27". Built from a fixed weekday array (not
 * Intl) so the "Weekday Day" ordering is stable across ICU locales.
 * Computed in UTC to avoid any date shift.
 */
export function shortDayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAY_SHORT[dt.getUTCDay()]} ${d}`;
}

/** "19:30" / "19:30:00" → "7:30 PM". */
export function formatTime12(value: string): string {
  const [hStr, mStr] = value.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "2026-06-20" → "20-June-2026". Built from a fixed month array (not
 * Intl) so the format is stable across locales, and computed by simple
 * splitting so there's no timezone shift.
 */
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${d}-${MONTHS_LONG[m - 1]}-${y}`;
}

function toMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Button label for an offered booking day: "Today · Sat 27",
 * "Tomorrow · Sun 28", or a plain "Mon 30" for days further out.
 * All variants stay within WhatsApp's 20-char button-title cap.
 */
export function dateButtonLabel(iso: string, todayIso: string): string {
  if (iso === todayIso) return `Today · ${shortDayLabel(iso)}`;
  if (iso === addDaysIso(todayIso, 1)) return `Tomorrow · ${shortDayLabel(iso)}`;
  return shortDayLabel(iso);
}

/**
 * True if any open window on a day ends after `nowHHMM` — i.e. there
 * is still bookable time left today. Used to decide whether to offer
 * "today" at all (a lunch-only restaurant at 8pm shouldn't show today).
 */
export function hasOpenTimeRemaining(
  windows: Array<{ start: string; end: string }>,
  nowHHMM: string,
): boolean {
  const now = toMin(nowHHMM);
  return windows.some((w) => toMin(w.end) > now);
}

function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * Enumerate selectable start times inside a set of open windows at a
 * fixed interval. Times strictly before `notBefore` (when given —
 * used to hide already-passed times today) are dropped. Returns a
 * sorted, de-duplicated list of "HH:MM" strings.
 */
export function enumerateStartTimes(
  windows: Array<{ start: string; end: string }>,
  intervalMinutes: number,
  notBefore?: string,
): string[] {
  const step = intervalMinutes > 0 ? intervalMinutes : 30;
  const floor = notBefore != null ? toMin(notBefore) : -1;
  const seen = new Set<string>();
  const out: number[] = [];
  for (const w of windows) {
    const s = toMin(w.start);
    const e = toMin(w.end);
    for (let t = s; t < e; t += step) {
      if (t < floor) continue;
      const key = toHHMM(t);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out.sort((a, b) => a - b).map(toHHMM);
}

/**
 * Down-sample a sorted list to at most `cap` items, spread evenly from
 * first to last (both endpoints always kept). WhatsApp interactive
 * lists allow a hard max of 10 rows, so for a wide open window (e.g.
 * 7am–10pm at 30-min steps = 30+ candidates) taking the *first* 10
 * would only ever surface the morning. Sampling across the range keeps
 * the offered times spanning the whole day. Items stay grid-aligned
 * because we only pick from the existing list.
 */
export function sampleEvenly<T>(items: T[], cap: number): T[] {
  if (cap <= 0) return [];
  if (items.length <= cap) return items.slice();
  const step = (items.length - 1) / (cap - 1);
  const out: T[] = [];
  for (let i = 0; i < cap; i++) {
    out.push(items[Math.round(i * step)]);
  }
  // Rounding can collide on small inputs — de-dup while preserving order.
  return Array.from(new Set(out));
}

// ============================================================
// DB-backed actions
// ============================================================

/** Read the account's booking timezone, defaulting when unset. */
export async function getAccountTimezone(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  const { data } = await db
    .from("booking_settings")
    .select("timezone")
    .eq("account_id", accountId)
    .maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return tz && tz.trim() ? tz : DEFAULT_BOOKING_TIMEZONE;
}

/**
 * Find the guest linked to a WhatsApp contact, creating one if none
 * exists. Mirrors the contact → guest link the dashboard creates: one
 * guest per (account, contact). Handles the concurrent-insert race by
 * re-selecting on a unique-violation.
 */
export async function resolveGuestForContact(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    contactId: string;
    /** Optional name to seed a newly-created guest with. */
    fallbackName?: string;
  },
): Promise<string> {
  const { accountId, userId, contactId, fallbackName } = args;

  const existing = await db
    .from("guests")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existing.data) return (existing.data as { id: string }).id;

  const { data: contact } = await db
    .from("contacts")
    .select("name, phone")
    .eq("id", contactId)
    .eq("account_id", accountId)
    .maybeSingle();

  const name =
    (fallbackName?.trim() ||
      (contact as { name?: string } | null)?.name?.trim() ||
      (contact as { phone?: string } | null)?.phone ||
      "WhatsApp guest").slice(0, 200);

  const { data: created, error } = await db
    .from("guests")
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      name,
      phone: (contact as { phone?: string } | null)?.phone ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    // Likely a concurrent insert won the unique (account, contact)
    // index — re-select the now-existing row.
    const again = await db
      .from("guests")
      .select("id")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .maybeSingle();
    if (again.data) return (again.data as { id: string }).id;
    throw new Error(`could not resolve guest: ${error?.message ?? "unknown"}`);
  }
  return (created as { id: string }).id;
}

export type CreateReservationResult =
  | { ok: true; reservationId: string }
  | { ok: false; error: string };

/**
 * Create a reservation from a flow run. Resolves the guest, re-checks
 * availability (the time may have filled since the list was sent), and
 * inserts the booking with no table assigned. Returns a friendly error
 * string instead of throwing so the engine can route to `error_next`.
 */
export async function createReservationFromFlow(
  db: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    contactId: string;
    reservationDate: string;
    startTime: string;
    partySize: number;
    status: ReservationStatus;
    guestName?: string;
    notes?: string | null;
  },
): Promise<CreateReservationResult> {
  if (!params.reservationDate || !/^\d{4}-\d{2}-\d{2}$/.test(params.reservationDate)) {
    return { ok: false, error: "missing or invalid date" };
  }
  if (!params.startTime || !/^\d{2}:\d{2}$/.test(params.startTime)) {
    return { ok: false, error: "missing or invalid time" };
  }
  if (!Number.isInteger(params.partySize) || params.partySize < 1) {
    return { ok: false, error: "invalid party size" };
  }

  let guestId: string;
  try {
    guestId = await resolveGuestForContact(db, {
      accountId: params.accountId,
      userId: params.userId,
      contactId: params.contactId,
      fallbackName: params.guestName,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "guest error" };
  }

  const state: BookingState = {
    reservation_date: params.reservationDate,
    start_time: params.startTime,
    end_time: null,
    table_id: null,
    party_size: params.partySize,
    status: params.status,
  };
  const check = await checkBooking(db, params.accountId, state);
  if (!check.ok) return { ok: false, error: check.error };

  const { data, error } = await db
    .from("reservations")
    .insert({
      account_id: params.accountId,
      user_id: params.userId,
      guest_id: guestId,
      table_id: null,
      reservation_date: params.reservationDate,
      start_time: params.startTime,
      party_size: params.partySize,
      status: params.status,
      notes: params.notes ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "could not save reservation" };
  }
  return { ok: true, reservationId: (data as { id: string }).id };
}
