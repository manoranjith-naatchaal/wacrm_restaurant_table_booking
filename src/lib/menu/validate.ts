// ============================================================
// Menu — input validation (pure, no I/O).
//
// Shared by the API route (so a hand-crafted POST/PATCH can't write a
// malformed row) and the UI form (so the user sees issues before
// submitting). Validates raw `unknown` input defensively because the
// server entry point is an untrusted JSON body. Mirrors the shape of
// `lib/tables/validate.ts`.
// ============================================================

export interface NormalizedMenuItemInput {
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
  is_available: boolean;
  sort_order: number;
}

export type MenuValidationResult =
  | { ok: true; value: NormalizedMenuItemInput }
  | { ok: false; errors: string[] };

export const MAX_NAME_LENGTH = 120;
export const MAX_CATEGORY_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 500;
// Sane upper bound — guards against fat-fingered prices while staying
// well within NUMERIC(10,2).
export const MAX_PRICE = 1_000_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate + normalise a raw menu-item payload.
 *
 * `partial` mode (used by PATCH) only validates fields that are
 * present, but still rejects present-yet-invalid values. In partial
 * mode the returned `value` contains only the provided fields, so
 * callers should treat absent keys as "leave unchanged".
 */
export function validateMenuItemInput(
  raw: unknown,
  opts: { partial?: boolean } = {},
): MenuValidationResult {
  const partial = opts.partial ?? false;
  const body = asRecord(raw);
  if (!body) {
    return { ok: false, errors: ["Request body must be an object."] };
  }

  const errors: string[] = [];
  const value: Partial<NormalizedMenuItemInput> = {};

  // ---- name ----
  if (!partial || "name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      errors.push("Name is required.");
    } else if (name.length > MAX_NAME_LENGTH) {
      errors.push(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
    } else {
      value.name = name;
    }
  }

  // ---- description (optional) ----
  if ("description" in body) {
    if (body.description === null || body.description === undefined) {
      value.description = null;
    } else if (typeof body.description === "string") {
      const description = body.description.trim();
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        errors.push(
          `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
        );
      } else {
        value.description = description || null;
      }
    } else {
      errors.push("Description must be text.");
    }
  } else if (!partial) {
    value.description = null;
  }

  // ---- category (optional) ----
  if ("category" in body) {
    if (body.category === null || body.category === undefined) {
      value.category = null;
    } else if (typeof body.category === "string") {
      const category = body.category.trim();
      if (category.length > MAX_CATEGORY_LENGTH) {
        errors.push(
          `Category must be ${MAX_CATEGORY_LENGTH} characters or fewer.`,
        );
      } else {
        value.category = category || null;
      }
    } else {
      errors.push("Category must be text.");
    }
  } else if (!partial) {
    value.category = null;
  }

  // ---- price (optional, nullable) ----
  if ("price" in body) {
    if (body.price === null || body.price === undefined || body.price === "") {
      value.price = null;
    } else {
      const price =
        typeof body.price === "number" ? body.price : Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        errors.push("Price must be a positive number (or left blank).");
      } else if (price > MAX_PRICE) {
        errors.push(`Price must be ${MAX_PRICE} or fewer.`);
      } else {
        // Round to 2 decimals to match NUMERIC(10,2).
        value.price = Math.round(price * 100) / 100;
      }
    }
  } else if (!partial) {
    value.price = null;
  }

  // ---- is_available (optional, defaults true) ----
  if ("is_available" in body) {
    if (typeof body.is_available === "boolean") {
      value.is_available = body.is_available;
    } else {
      errors.push("is_available must be true or false.");
    }
  } else if (!partial) {
    value.is_available = true;
  }

  // ---- sort_order (optional, defaults 0) ----
  if ("sort_order" in body) {
    const sort =
      typeof body.sort_order === "number"
        ? body.sort_order
        : Number(body.sort_order);
    if (!Number.isInteger(sort) || sort < 0) {
      errors.push("Sort order must be a whole number of 0 or more.");
    } else {
      value.sort_order = sort;
    }
  } else if (!partial) {
    value.sort_order = 0;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // In partial mode a payload with no recognised fields is a no-op
  // mistake — surface it rather than issuing an empty UPDATE.
  if (partial && Object.keys(value).length === 0) {
    return { ok: false, errors: ["No valid fields to update."] };
  }

  return { ok: true, value: value as NormalizedMenuItemInput };
}
