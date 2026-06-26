// ============================================================
// Tables & Seating — input validation (pure, no I/O).
//
// Shared by the API route (so a hand-crafted POST/PATCH can't write
// a malformed row) and the UI form (so the user sees issues before
// submitting). Validates raw `unknown` input defensively because the
// server entry point is an untrusted JSON body.
// ============================================================

export interface TableInput {
  label: string;
  capacity: number;
  area?: string | null;
  is_active?: boolean;
  notes?: string | null;
}

/** Fully-normalised, safe-to-insert shape. */
export interface NormalizedTableInput {
  label: string;
  capacity: number;
  area: string | null;
  is_active: boolean;
  notes: string | null;
}

export type ValidationResult =
  | { ok: true; value: NormalizedTableInput }
  | { ok: false; errors: string[] };

export const MAX_LABEL_LENGTH = 60;
export const MAX_AREA_LENGTH = 60;
export const MAX_NOTES_LENGTH = 500;
// A sane upper bound — guards against typos like "1000000" seats and
// keeps the column within INTEGER without inviting absurd values.
export const MAX_CAPACITY = 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate + normalise a raw table payload.
 *
 * `partial` mode (used by PATCH) only validates fields that are
 * present, but still rejects present-yet-invalid values. In partial
 * mode the returned `value` contains only the provided fields, so
 * callers should treat absent keys as "leave unchanged".
 */
export function validateTableInput(
  raw: unknown,
  opts: { partial?: boolean } = {}
): ValidationResult {
  const partial = opts.partial ?? false;
  const body = asRecord(raw);
  if (!body) {
    return { ok: false, errors: ['Request body must be an object.'] };
  }

  const errors: string[] = [];
  const value: Partial<NormalizedTableInput> = {};

  // ---- label ----
  if (!partial || 'label' in body) {
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) {
      errors.push('Label is required.');
    } else if (label.length > MAX_LABEL_LENGTH) {
      errors.push(`Label must be ${MAX_LABEL_LENGTH} characters or fewer.`);
    } else {
      value.label = label;
    }
  }

  // ---- capacity ----
  if (!partial || 'capacity' in body) {
    const capacity = body.capacity;
    if (
      typeof capacity !== 'number' ||
      !Number.isInteger(capacity) ||
      capacity < 1
    ) {
      errors.push('Capacity must be a whole number of at least 1.');
    } else if (capacity > MAX_CAPACITY) {
      errors.push(`Capacity must be ${MAX_CAPACITY} or fewer.`);
    } else {
      value.capacity = capacity;
    }
  }

  // ---- area (optional) ----
  if ('area' in body) {
    if (body.area === null || body.area === undefined) {
      value.area = null;
    } else if (typeof body.area === 'string') {
      const area = body.area.trim();
      if (area.length > MAX_AREA_LENGTH) {
        errors.push(`Area must be ${MAX_AREA_LENGTH} characters or fewer.`);
      } else {
        value.area = area || null;
      }
    } else {
      errors.push('Area must be text.');
    }
  } else if (!partial) {
    value.area = null;
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

  // ---- notes (optional) ----
  if ('notes' in body) {
    if (body.notes === null || body.notes === undefined) {
      value.notes = null;
    } else if (typeof body.notes === 'string') {
      const notes = body.notes.trim();
      if (notes.length > MAX_NOTES_LENGTH) {
        errors.push(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
      } else {
        value.notes = notes || null;
      }
    } else {
      errors.push('Notes must be text.');
    }
  } else if (!partial) {
    value.notes = null;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // In partial mode a payload with no recognised fields is a no-op
  // mistake — surface it rather than issuing an empty UPDATE.
  if (partial && Object.keys(value).length === 0) {
    return { ok: false, errors: ['No valid fields to update.'] };
  }

  return { ok: true, value: value as NormalizedTableInput };
}
