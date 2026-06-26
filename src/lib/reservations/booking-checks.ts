// ============================================================
// Reservation booking checks (DB-backed).
//
// Layered on top of the pure shape validation: these need account
// data (slots, exceptions, tables, other reservations) so they live
// server-side. Used by the create/update routes and the availability
// endpoint.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getOpenWindowsForDate,
  isStartTimeAvailable,
  type DayAvailability,
  type ExceptionLike,
  type SlotLike,
} from './availability';
import type { ReservationStatus } from '@/types';

/** Statuses that don't occupy a slot/table (skip availability checks). */
const INACTIVE_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  'cancelled',
  'no_show',
]);

interface AvailabilityInputs {
  slots: SlotLike[];
  exceptions: ExceptionLike[];
}

/** Load the active slots + date-covering exceptions for one date. */
async function loadInputs(
  supabase: SupabaseClient,
  accountId: string,
  dateIso: string
): Promise<AvailabilityInputs> {
  const [slotsRes, exRes] = await Promise.all([
    supabase
      .from('booking_slots')
      .select('day_of_week, start_time, end_time, is_active')
      .eq('account_id', accountId)
      .eq('is_active', true),
    supabase
      .from('booking_exceptions')
      .select('kind, start_date, end_date, start_time, end_time')
      .eq('account_id', accountId)
      .lte('start_date', dateIso)
      .gte('end_date', dateIso),
  ]);

  return {
    slots: (slotsRes.data as SlotLike[]) ?? [],
    exceptions: (exRes.data as ExceptionLike[]) ?? [],
  };
}

/** Open windows for a date — backs the availability endpoint + UI. */
export async function getAccountAvailability(
  supabase: SupabaseClient,
  accountId: string,
  dateIso: string
): Promise<DayAvailability> {
  const { slots, exceptions } = await loadInputs(supabase, accountId, dateIso);
  return getOpenWindowsForDate(dateIso, slots, exceptions);
}

export interface BookingState {
  reservation_date: string;
  start_time: string;
  end_time: string | null;
  table_id: string | null;
  party_size: number;
  status: ReservationStatus;
}

export type CheckResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Two reservations on the same table/date conflict? */
function timesConflict(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null
): boolean {
  // Same start always conflicts.
  if (aStart === bStart) return true;
  // If both have ends, check true interval overlap.
  if (aEnd && bEnd) return aStart < bEnd && bStart < aEnd;
  // One side open-ended: only the same-start case (above) conflicts.
  return false;
}

/**
 * Validate a reservation against availability + table fit/conflict.
 * `excludeId` skips the row being edited when checking table clashes.
 * Cancelled / no-show reservations skip all checks.
 */
export async function checkBooking(
  supabase: SupabaseClient,
  accountId: string,
  state: BookingState,
  opts: { excludeId?: string } = {}
): Promise<CheckResult> {
  if (INACTIVE_STATUSES.has(state.status)) {
    return { ok: true };
  }

  // ---- 1. Availability (open window for the date/time) ----
  const { slots, exceptions } = await loadInputs(
    supabase,
    accountId,
    state.reservation_date
  );
  if (
    !isStartTimeAvailable(
      state.reservation_date,
      state.start_time,
      slots,
      exceptions
    )
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "The restaurant isn't open for bookings at that time on that date. Check Slots & Timings and Closures & Exceptions.",
    };
  }

  if (!state.table_id) {
    return { ok: true };
  }

  // ---- 2. Table fit ----
  const { data: table, error: tableErr } = await supabase
    .from('restaurant_tables')
    .select('id, label, capacity, is_active')
    .eq('id', state.table_id)
    .eq('account_id', accountId)
    .maybeSingle();

  if (tableErr) {
    return { ok: false, status: 500, error: tableErr.message };
  }
  if (!table) {
    return { ok: false, status: 400, error: 'Selected table was not found.' };
  }
  if (!table.is_active) {
    return {
      ok: false,
      status: 400,
      error: `Table "${table.label}" is inactive and can't be assigned.`,
    };
  }
  if (state.party_size > table.capacity) {
    return {
      ok: false,
      status: 400,
      error: `Party of ${state.party_size} exceeds table "${table.label}" capacity (${table.capacity}).`,
    };
  }

  // ---- 3. Table double-booking ----
  let query = supabase
    .from('reservations')
    .select('id, start_time, end_time, status')
    .eq('account_id', accountId)
    .eq('table_id', state.table_id)
    .eq('reservation_date', state.reservation_date)
    .not('status', 'in', '(cancelled,no_show)');
  if (opts.excludeId) {
    query = query.neq('id', opts.excludeId);
  }
  const { data: clashes, error: clashErr } = await query;
  if (clashErr) {
    return { ok: false, status: 500, error: clashErr.message };
  }

  const conflict = (clashes ?? []).some((r) =>
    timesConflict(
      state.start_time,
      state.end_time,
      (r.start_time as string).slice(0, 5),
      r.end_time ? (r.end_time as string).slice(0, 5) : null
    )
  );
  if (conflict) {
    return {
      ok: false,
      status: 409,
      error: `Table "${table.label}" is already booked at that time.`,
    };
  }

  return { ok: true };
}
