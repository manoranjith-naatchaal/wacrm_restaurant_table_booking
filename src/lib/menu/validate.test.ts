import { describe, expect, it } from "vitest";

import { validateMenuItemInput } from "./validate";

describe("validateMenuItemInput", () => {
  it("accepts a full, valid payload", () => {
    const res = validateMenuItemInput({
      name: "  Margherita  ",
      category: " Pizza ",
      price: 9.999,
      description: " Classic ",
      is_available: true,
      sort_order: 3,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.name).toBe("Margherita");
      expect(res.value.category).toBe("Pizza");
      // Rounded to NUMERIC(10,2).
      expect(res.value.price).toBe(10);
      expect(res.value.description).toBe("Classic");
      expect(res.value.sort_order).toBe(3);
    }
  });

  it("requires a name", () => {
    const res = validateMenuItemInput({ name: "   " });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/name/i);
  });

  it("treats a blank price as null (market price)", () => {
    const res = validateMenuItemInput({ name: "Fish", price: "" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.price).toBeNull();
  });

  it("rejects a negative price", () => {
    const res = validateMenuItemInput({ name: "X", price: -1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/price/i);
  });

  it("rejects a non-integer sort order", () => {
    const res = validateMenuItemInput({ name: "X", sort_order: 1.5 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/sort order/i);
  });

  it("coerces empty optional strings to null", () => {
    const res = validateMenuItemInput({
      name: "X",
      category: "",
      description: "",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.category).toBeNull();
      expect(res.value.description).toBeNull();
    }
  });

  it("in partial mode only returns provided fields", () => {
    const res = validateMenuItemInput(
      { is_available: false },
      { partial: true },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({ is_available: false });
    }
  });

  it("in partial mode rejects an empty patch", () => {
    const res = validateMenuItemInput({}, { partial: true });
    expect(res.ok).toBe(false);
  });
});
