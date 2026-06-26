// ============================================================
// Closures & Exceptions — input validation (pure, no I/O).
//
// Shared by the API route and the UI form. Mirrors the DB's
// booking_exceptions_shape CHECK so bad payloads are rejected with a
// friendly message before they ever hit Postgres.
// ============================================================

import { normalizeTime } from '@/lib/slots/validate';

export const EXCEPTION_KINDS = [
  'closed_all_day',
  'closed_time',
  'open_special',
] as const;

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

/** Kinds that require a start/end time window. */
const TIMED_KINDS: ReadonlySet<string> = new Set([
  'closed_time',
  'open_special',
]);

export const MAX_REASON_LENGTH = 200;

export interface NormalizedExceptionInput {
  kind: ExceptionKind;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

export type ValidationResult =
  | { ok: true; value: NormalizedExceptionInput }
  | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Validate "YYYY-MM-DD" and confirm it's a real calendar date. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) return null;
  // Guard against "2026-02-31" — Date normalises it, so round-trip it.
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

/**
 * Validate a create or partial-update payload. Unlike slots/tables,
 * exceptions are cross-field (times depend on `kind`), so the result
 * is always a fully-resolved row: callers should send the complete
 * intended shape (the UI form always does). Partial mode only relaxes
 * which top-level keys must be present, not the kind↔time coupling.
 */
export function validateExceptionInput(raw: unknown): ValidationResult {
  const body = asRecord(raw);
  if (!body) {
    return { ok: false, errors: ['Request body must be an object.'] };
  }

  const errors: string[] = [];

  // ---- kind ----
  const kind = body.kind;
  const validKind =
    typeof kind === 'string' &&
    (EXCEPTION_KINDS as readonly string[]).includes(kind);
  if (!validKind) {
    errors.push(
      'Type must be one of: closed_all_day, closed_time, open_special.'
    );
  }

  // ---- dates ----
  const startDate = normalizeDate(body.start_date);
  if (!startDate) errors.push('Start date must be a valid date (YYYY-MM-DD).');

  // end_date is optional on input — defaults to start_date (single day).
  let endDate: string | null;
  if (body.end_date == null || body.end_date === '') {
    endDate = startDate;
  } else {
    endDate = normalizeDate(body.end_date);
    if (!endDate) errors.push('End date must be a valid date (YYYY-MM-DD).');
  }

  if (startDate && endDate && endDate < startDate) {
    errors.push("End date can't be before the start date.");
  }

  // ---- times (coupled to kind) ----
  let startTime: string | null = null;
  let endTime: string | null = null;
  if (validKind) {
    if (TIMED_KINDS.has(kind as string)) {
      startTime = normalizeTime(body.start_time);
      endTime = normalizeTime(body.end_time);
      if (!startTime) errors.push('Start time must be a valid time (HH:MM).');
      if (!endTime) errors.push('End time must be a valid time (HH:MM).');
      if (startTime && endTime && endTime <= startTime) {
        errors.push('End time must be after start time.');
      }
    } else {
      // closed_all_day: times must be absent. Ignore any sent values.
      startTime = null;
      endTime = null;
    }
  }

  // ---- reason (optional) ----
  let reason: string | null = null;
  if (body.reason != null && body.reason !== '') {
    if (typeof body.reason !== 'string') {
      errors.push('Reason must be text.');
    } else if (body.reason.trim().length > MAX_REASON_LENGTH) {
      errors.push(`Reason must be ${MAX_REASON_LENGTH} characters or fewer.`);
    } else {
      reason = body.reason.trim();
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      kind: kind as ExceptionKind,
      start_date: startDate as string,
      end_date: endDate as string,
      start_time: startTime,
      end_time: endTime,
      reason,
    },
  };
}
