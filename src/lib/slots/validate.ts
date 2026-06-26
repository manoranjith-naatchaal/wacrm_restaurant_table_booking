// ============================================================
// Slots & Timings — input validation (pure, no I/O).
//
// Shared by the API route and the UI form. Validates raw `unknown`
// input defensively (the server entry point is an untrusted body)
// and normalises times to "HH:MM".
// ============================================================

export interface SlotInput {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active?: boolean;
}

export interface NormalizedSlotInput {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export type ValidationResult =
  | { ok: true; value: NormalizedSlotInput }
  | { ok: false; errors: string[] };

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Normalise a time-ish value to "HH:MM", or return null if it isn't
 * a valid 24h time. Accepts "HH:MM" and "HH:MM:SS" (the form the DB
 * `TIME` column serialises back as) — trailing seconds are dropped.
 */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const hhmm = trimmed.length > 5 ? trimmed.slice(0, 5) : trimmed;
  return TIME_RE.test(hhmm) ? hhmm : null;
}

/** "HH:MM" → minutes since midnight. Assumes a validated input. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function validateSlotInput(
  raw: unknown,
  opts: { partial?: boolean } = {}
): ValidationResult {
  const partial = opts.partial ?? false;
  const body = asRecord(raw);
  if (!body) {
    return { ok: false, errors: ['Request body must be an object.'] };
  }

  const errors: string[] = [];
  const value: Partial<NormalizedSlotInput> = {};

  // ---- day_of_week ----
  if (!partial || 'day_of_week' in body) {
    const dow = body.day_of_week;
    if (
      typeof dow !== 'number' ||
      !Number.isInteger(dow) ||
      dow < 0 ||
      dow > 6
    ) {
      errors.push('Day of week must be an integer from 0 (Sun) to 6 (Sat).');
    } else {
      value.day_of_week = dow;
    }
  }

  // ---- start_time ----
  let normStart: string | null | undefined;
  if (!partial || 'start_time' in body) {
    normStart = normalizeTime(body.start_time);
    if (!normStart) {
      errors.push('Start time must be a valid time (HH:MM).');
    } else {
      value.start_time = normStart;
    }
  }

  // ---- end_time ----
  let normEnd: string | null | undefined;
  if (!partial || 'end_time' in body) {
    normEnd = normalizeTime(body.end_time);
    if (!normEnd) {
      errors.push('End time must be a valid time (HH:MM).');
    } else {
      value.end_time = normEnd;
    }
  }

  // ---- end after start ----
  // Only checks when both ends are known and individually valid. In
  // partial mode where only one side is supplied, the DB CHECK is the
  // backstop (the caller can't see the other side here).
  if (
    value.start_time !== undefined &&
    value.end_time !== undefined &&
    toMinutes(value.end_time) <= toMinutes(value.start_time)
  ) {
    errors.push('End time must be after start time.');
  }

  // ---- is_active (optional, defaults true) ----
  if ('is_active' in body) {
    if (typeof body.is_active === 'boolean') {
      value.is_active = body.is_active;
    } else {
      errors.push('is_active must be true or false.');
    }
  } else if (!partial) {
    value.is_active = true;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (partial && Object.keys(value).length === 0) {
    return { ok: false, errors: ['No valid fields to update.'] };
  }

  return { ok: true, value: value as NormalizedSlotInput };
}
