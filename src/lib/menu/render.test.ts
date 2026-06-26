import { describe, expect, it } from "vitest";

import type { MenuItem } from "@/types";
import {
  UNCATEGORIZED_LABEL,
  formatMenuPrice,
  groupMenu,
  renderMenuText,
} from "./render";

function item(partial: Partial<MenuItem> & { name: string }): MenuItem {
  return {
    id: partial.id ?? partial.name,
    account_id: "acc",
    user_id: null,
    name: partial.name,
    description: partial.description ?? null,
    category: partial.category ?? null,
    price: partial.price ?? null,
    is_available: partial.is_available ?? true,
    sort_order: partial.sort_order ?? 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("formatMenuPrice", () => {
  it("keeps two minor-unit digits", () => {
    const out = formatMenuPrice(12.5, "USD");
    expect(out).toContain("12.50");
  });

  it("falls back to CODE + amount on an invalid currency", () => {
    expect(formatMenuPrice(9.9, "NOTACODE")).toBe("NOTACODE 9.90");
  });
});

describe("groupMenu", () => {
  it("buckets items by category and sorts items by sort_order then name", () => {
    const groups = groupMenu([
      item({ name: "Tiramisu", category: "Dessert", sort_order: 1 }),
      item({ name: "Bruschetta", category: "Starter", sort_order: 1 }),
      item({ name: "Calamari", category: "Starter", sort_order: 0 }),
    ]);
    const starter = groups.find((g) => g.category === "Starter");
    expect(starter?.items.map((i) => i.name)).toEqual([
      "Calamari",
      "Bruschetta",
    ]);
  });

  it("orders categories by their lowest sort_order, never splitting them", () => {
    const groups = groupMenu([
      item({ name: "A", category: "Mains", sort_order: 5 }),
      item({ name: "B", category: "Starters", sort_order: 1 }),
      item({ name: "C", category: "Mains", sort_order: 2 }),
    ]);
    // Mains has min sort_order 2, Starters has 1 → Starters first.
    expect(groups.map((g) => g.category)).toEqual(["Starters", "Mains"]);
    // Mains stays a single contiguous group.
    expect(groups[1].items.map((i) => i.name)).toEqual(["C", "A"]);
  });

  it("always places the uncategorised group last", () => {
    const groups = groupMenu([
      item({ name: "Loose", sort_order: 0 }),
      item({ name: "Soup", category: "Starters", sort_order: 9 }),
    ]);
    expect(groups[groups.length - 1].category).toBe(UNCATEGORIZED_LABEL);
  });
});

describe("renderMenuText", () => {
  it("returns an empty string for no items", () => {
    expect(renderMenuText([])).toBe("");
  });

  it("renders bold category headers, bullets, prices, and descriptions", () => {
    const out = renderMenuText(
      [
        item({
          name: "Margherita",
          category: "Pizza",
          price: 9,
          description: "Tomato & mozzarella",
        }),
      ],
      { currency: "USD" },
    );
    expect(out).toContain("*Pizza*");
    expect(out).toContain("• Margherita — $9.00");
    expect(out).toContain("Tomato & mozzarella");
  });

  it("omits prices and descriptions when disabled", () => {
    const out = renderMenuText(
      [
        item({
          name: "Margherita",
          category: "Pizza",
          price: 9,
          description: "Tomato & mozzarella",
        }),
      ],
      { currency: "USD", includePrices: false, includeDescriptions: false },
    );
    expect(out).toContain("• Margherita");
    expect(out).not.toContain("$9.00");
    expect(out).not.toContain("Tomato & mozzarella");
  });

  it("prepends the intro line when provided", () => {
    const out = renderMenuText([item({ name: "X", category: "Y" })], {
      introText: "Here's our menu:",
    });
    expect(out.startsWith("Here's our menu:")).toBe(true);
  });

  it("renders items with no price as a plain bullet", () => {
    const out = renderMenuText([item({ name: "Market Fish", category: "Sea" })]);
    expect(out).toContain("• Market Fish");
    expect(out).not.toContain("—");
  });
});
