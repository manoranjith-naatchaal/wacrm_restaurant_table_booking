// ============================================================
// Reservations — input validation (pure, no I/O).
//
// Validates the request SHAPE only. Availability (does the time fall
// in an open window?) and table fit/conflict need DB data and are
// enforced in the API route on top of this.
// ============================================================

import { normalizeTime } from '@/lib/slots/validate';
import { normalizeDate } from '@/lib/exceptions/validate';
import type { ReservationStatus } from '@/types';

export const RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const MAX_PARTY_SIZE = 1000;
export const MAX_NOTES_LENGTH = 2000;

export interface NormalizedReservationInput {
  guest_id: string;
  table_id: string | null;
  reservation_date: string;
  start_time: string;
  end_time: string | null;
  party_size: number;
  status: ReservationStatus;
  notes: string | null;
}

export type ValidationResult =
  | { ok: true; value: Partial<NormalizedReservationInput> }
  | { ok: false; errors: string[] };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function validateReservationInput(
  raw: unknown,
  opts: { partial?: boolean } = {}
): ValidationResult {
  const partial = opts.partial ?? false;
  const body = asRecord(raw);
  if (!body) {
    return { ok: false, errors: ['Request body must be an object.'] };
  }

  const errors: string[] = [];
  const value: Partial<NormalizedReservationInput> = {};

  // ---- guest_id (required on create) ----
  if (!partial || 'guest_id' in body) {
    const gid = body.guest_id;
    if (typeof gid === 'string' && UUID_RE.test(gid)) {
      value.guest_id = gid;
    } else {
      errors.push('A valid guest is required.');
    }
  }

  // ---- table_id (optional link) ----
  if ('table_id' in body) {
    const tid = body.table_id;
    if (tid == null || tid === '') {
      value.table_id = null;
    } else if (typeof tid === 'string' && UUID_RE.test(tid)) {
      value.table_id = tid;
    } else {
      errors.push('Selected table is invalid.');
    }
  }

  // ---- reservation_date ----
  if (!partial || 'reservation_date' in body) {
    const d = normalizeDate(body.reservation_date);
    if (d) {
      value.reservation_date = d;
    } else {
      errors.push('Date must be a valid date (YYYY-MM-DD).');
    }
  }

  // ---- start_time ----
  if (!partial || 'start_time' in body) {
    const t = normalizeTime(body.start_time);
    if (t) {
      value.start_time = t;
    } else {
      errors.push('Start time must be a valid time (HH:MM).');
    }
  }

  // ---- end_time (optional) ----
  if ('end_time' in body) {
    const raw_end = body.end_time;
    if (raw_end == null || raw_end === '') {
      value.end_time = null;
    } else {
      const t = normalizeTime(raw_end);
      if (t) {
        value.end_time = t;
      } else {
        errors.push('End time must be a valid time (HH:MM).');
      }
    }
  }

  // end after start (when both known and valid).
  if (
    value.start_time !== undefined &&
    value.end_time != null &&
    toMin(value.end_time) <= toMin(value.start_time)
  ) {
    errors.push('End time must be after start time.');
  }

  // ---- party_size ----
  if (!partial || 'party_size' in body) {
    const p = body.party_size;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1) {
      errors.push('Party size must be a whole number of at least 1.');
    } else if (p > MAX_PARTY_SIZE) {
      errors.push(`Party size must be ${MAX_PARTY_SIZE} or fewer.`);
    } else {
      value.party_size = p;
    }
  }

  // ---- status (optional; defaults pending on create) ----
  if ('status' in body) {
    const s = body.status;
    if (
      typeof s === 'string' &&
      (RESERVATION_STATUSES as readonly string[]).includes(s)
    ) {
      value.status = s as ReservationStatus;
    } else {
      errors.push('Status is invalid.');
    }
  } else if (!partial) {
    value.status = 'pending';
  }

  // ---- notes (optional) ----
  if ('notes' in body) {
    const n = body.notes;
    if (n == null || n === '') {
      value.notes = null;
    } else if (typeof n !== 'string') {
      errors.push('Notes must be text.');
    } else if (n.trim().length > MAX_NOTES_LENGTH) {
      errors.push(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
    } else {
      value.notes = n.trim();
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (partial && Object.keys(value).length === 0) {
    return { ok: false, errors: ['No valid fields to update.'] };
  }

  return { ok: true, value };
}
