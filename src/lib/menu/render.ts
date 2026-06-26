// ============================================================
// Menu — pure rendering helpers.
//
// Used by both the dashboard preview and the `show_menu` flow node to
// turn a flat list of menu items into a grouped, WhatsApp-friendly
// text block. Kept pure (no I/O) so it's trivially unit-testable; the
// engine does the DB read and currency lookup, then calls in here.
// ============================================================

import { DEFAULT_CURRENCY } from "@/lib/currency";
import type { MenuItem } from "@/types";

/** Items with no category fall under this label, sorted to the end. */
export const UNCATEGORIZED_LABEL = "More";

export interface MenuGroup {
  category: string;
  items: MenuItem[];
}

/**
 * Format a menu price with 2 decimals in the given currency, e.g.
 * "$12.50" / "₹450.00". Unlike `formatCurrency` (whole-dollar deal
 * values), menu prices keep minor units. Falls back to "CODE 12.50"
 * on a structurally invalid ISO code so a render never throws.
 */
export function formatMenuPrice(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

/**
 * Group items by category for display.
 *
 * - Items are placed under their `category` (trimmed); blank/missing
 *   categories fall under {@link UNCATEGORIZED_LABEL}.
 * - Category order follows the lowest `sort_order` among its items
 *   (then category name) — so giving one item a low sort_order pulls
 *   its whole category up, and a category never gets split.
 * - Items within a category are ordered by `sort_order`, then `name`.
 * - The uncategorised group is always sorted last.
 */
export function groupMenu(items: MenuItem[]): MenuGroup[] {
  const buckets = new Map<string, MenuItem[]>();
  for (const item of items) {
    const cat = item.category?.trim() || UNCATEGORIZED_LABEL;
    const list = buckets.get(cat);
    if (list) list.push(item);
    else buckets.set(cat, [item]);
  }

  const groups: MenuGroup[] = [];
  for (const [category, groupItems] of buckets) {
    groupItems.sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    groups.push({ category, items: groupItems });
  }

  groups.sort((a, b) => {
    // Uncategorised always last.
    const aUncat = a.category === UNCATEGORIZED_LABEL;
    const bUncat = b.category === UNCATEGORIZED_LABEL;
    if (aUncat !== bUncat) return aUncat ? 1 : -1;
    const aMin = a.items[0]?.sort_order ?? 0;
    const bMin = b.items[0]?.sort_order ?? 0;
    return (
      aMin - bMin ||
      a.category.localeCompare(b.category, undefined, { sensitivity: "base" })
    );
  });

  return groups;
}

export interface RenderMenuOptions {
  /** Currency code for prices. Defaults to the app fallback. */
  currency?: string;
  /** Optional intro line above the menu. */
  introText?: string;
  /** Include prices next to each item. Default true. */
  includePrices?: boolean;
  /** Include item descriptions. Default true. */
  includeDescriptions?: boolean;
}

/**
 * Render a list of menu items as a WhatsApp text block. Categories
 * become *bold* headers; items are bulleted with an optional price and
 * description. Returns an empty string when there are no items so the
 * caller can decide on a fallback message.
 */
export function renderMenuText(
  items: MenuItem[],
  opts: RenderMenuOptions = {},
): string {
  if (items.length === 0) return "";

  const currency = opts.currency || DEFAULT_CURRENCY;
  const includePrices = opts.includePrices ?? true;
  const includeDescriptions = opts.includeDescriptions ?? true;

  const lines: string[] = [];
  const intro = opts.introText?.trim();
  if (intro) {
    lines.push(intro, "");
  }

  const groups = groupMenu(items);
  groups.forEach((group, gi) => {
    lines.push(`*${group.category}*`);
    for (const item of group.items) {
      const priceStr =
        includePrices && typeof item.price === "number"
          ? ` — ${formatMenuPrice(item.price, currency)}`
          : "";
      lines.push(`• ${item.name}${priceStr}`);
      const desc = item.description?.trim();
      if (includeDescriptions && desc) {
        lines.push(`  ${desc}`);
      }
    }
    // Blank line between groups (not after the last one).
    if (gi < groups.length - 1) lines.push("");
  });

  return lines.join("\n");
}
