// ============================================================
// Guests — input validation (pure, no I/O).
//
// Shared by the API route and the UI form. Normalises optional
// fields to null/[]/trimmed so empty strings never reach the DB.
// ============================================================

export const MAX_NAME_LENGTH = 120;
export const MAX_PHONE_LENGTH = 40;
export const MAX_EMAIL_LENGTH = 200;
export const MAX_DIETARY_LENGTH = 500;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 20;

export interface NormalizedGuestInput {
  contact_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  is_vip: boolean;
  dietary_notes: string | null;
  notes: string | null;
  tags: string[];
}

export type ValidationResult =
  | { ok: true; value: Partial<NormalizedGuestInput> }
  | { ok: false; errors: string[] };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pragmatic email shape check — not RFC-complete, just catches typos.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Trim, drop empties, dedupe (case-insensitive), and cap a tag list. */
function normalizeTags(raw: unknown, errors: string[]): string[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push('Tags must be a list.');
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      errors.push('Each tag must be text.');
      return undefined;
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_TAG_LENGTH) {
      errors.push(`Tags must be ${MAX_TAG_LENGTH} characters or fewer.`);
      return undefined;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  if (out.length > MAX_TAGS) {
    errors.push(`A guest can have at most ${MAX_TAGS} tags.`);
    return undefined;
  }
  return out;
}

export function validateGuestInput(
  raw: unknown,
  opts: { partial?: boolean } = {}
): ValidationResult {
  const partial = opts.partial ?? false;
  const body = asRecord(raw);
  if (!body) {
    return { ok: false, errors: ['Request body must be an object.'] };
  }

  const errors: string[] = [];
  const value: Partial<NormalizedGuestInput> = {};

  // ---- name (required unless partial & omitted) ----
  if (!partial || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      errors.push('Name is required.');
    } else if (name.length > MAX_NAME_LENGTH) {
      errors.push(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
    } else {
      value.name = name;
    }
  }

  // ---- contact_id (optional link) ----
  if ('contact_id' in body) {
    const cid = body.contact_id;
    if (cid == null || cid === '') {
      value.contact_id = null;
    } else if (typeof cid === 'string' && UUID_RE.test(cid)) {
      value.contact_id = cid;
    } else {
      errors.push('Linked contact is invalid.');
    }
  }

  // ---- phone (optional) ----
  if ('phone' in body) {
    const phone = body.phone;
    if (phone == null || phone === '') {
      value.phone = null;
    } else if (typeof phone !== 'string') {
      errors.push('Phone must be text.');
    } else if (phone.trim().length > MAX_PHONE_LENGTH) {
      errors.push(`Phone must be ${MAX_PHONE_LENGTH} characters or fewer.`);
    } else {
      value.phone = phone.trim();
    }
  }

  // ---- email (optional) ----
  if ('email' in body) {
    const email = body.email;
    if (email == null || email === '') {
      value.email = null;
    } else if (typeof email !== 'string') {
      errors.push('Email must be text.');
    } else if (email.trim().length > MAX_EMAIL_LENGTH) {
      errors.push(`Email must be ${MAX_EMAIL_LENGTH} characters or fewer.`);
    } else if (!EMAIL_RE.test(email.trim())) {
      errors.push('Email looks invalid.');
    } else {
      value.email = email.trim();
    }
  }

  // ---- is_vip (optional, defaults false on create) ----
  if ('is_vip' in body) {
    if (typeof body.is_vip === 'boolean') {
      value.is_vip = body.is_vip;
    } else {
      errors.push('VIP flag must be true or false.');
    }
  } else if (!partial) {
    value.is_vip = false;
  }

  // ---- dietary_notes (optional) ----
  if ('dietary_notes' in body) {
    const d = body.dietary_notes;
    if (d == null || d === '') {
      value.dietary_notes = null;
    } else if (typeof d !== 'string') {
      errors.push('Dietary notes must be text.');
    } else if (d.trim().length > MAX_DIETARY_LENGTH) {
      errors.push(
        `Dietary notes must be ${MAX_DIETARY_LENGTH} characters or fewer.`
      );
    } else {
      value.dietary_notes = d.trim();
    }
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

  // ---- tags (optional) ----
  if ('tags' in body) {
    const tags = normalizeTags(body.tags, errors);
    if (tags !== undefined) value.tags = tags;
  } else if (!partial) {
    value.tags = [];
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (partial && Object.keys(value).length === 0) {
    return { ok: false, errors: ['No valid fields to update.'] };
  }

  return { ok: true, value };
}
