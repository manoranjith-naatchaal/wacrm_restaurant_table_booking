import { describe, expect, it } from "vitest";

import {
  getOpenWindowsForDate,
  isStartTimeAvailable,
  weekdayOf,
  type ExceptionLike,
  type SlotLike,
} from "./availability";

// 2026-06-22 is a Monday (day_of_week = 1).
const MON = "2026-06-22";

const slots: SlotLike[] = [
  { day_of_week: 1, start_time: "12:00", end_time: "14:00", is_active: true },
  { day_of_week: 1, start_time: "19:00", end_time: "22:00", is_active: true },
  // Inactive slot must be ignored.
  { day_of_week: 1, start_time: "08:00", end_time: "10:00", is_active: false },
  // Different weekday must be ignored.
  { day_of_week: 2, start_time: "12:00", end_time: "14:00", is_active: true },
];

function ex(partial: Partial<ExceptionLike>): ExceptionLike {
  return {
    kind: "closed_all_day",
    start_date: MON,
    end_date: MON,
    start_time: null,
    end_time: null,
    ...partial,
  };
}

describe("weekdayOf", () => {
  it("maps ISO dates to JS weekday", () => {
    expect(weekdayOf("2026-06-22")).toBe(1); // Monday
    expect(weekdayOf("2026-06-21")).toBe(0); // Sunday
  });
});

describe("getOpenWindowsForDate", () => {
  it("returns active slots for the weekday, sorted", () => {
    const { closed, windows } = getOpenWindowsForDate(MON, slots, []);
    expect(closed).toBe(false);
    expect(windows).toEqual([
      { start: "12:00", end: "14:00" },
      { start: "19:00", end: "22:00" },
    ]);
  });

  it("accepts HH:MM:SS times from the DB", () => {
    const dbSlots: SlotLike[] = [
      {
        day_of_week: 1,
        start_time: "12:00:00",
        end_time: "14:00:00",
        is_active: true,
      },
    ];
    expect(getOpenWindowsForDate(MON, dbSlots, []).windows).toEqual([
      { start: "12:00", end: "14:00" },
    ]);
  });

  it("closed_all_day wins over everything", () => {
    const result = getOpenWindowsForDate(MON, slots, [
      ex({ kind: "closed_all_day" }),
      ex({ kind: "open_special", start_time: "10:00", end_time: "11:00" }),
    ]);
    expect(result.closed).toBe(true);
    expect(result.windows).toEqual([]);
  });

  it("adds open_special windows (even on a day with no slots)", () => {
    const sunday = "2026-06-21";
    const result = getOpenWindowsForDate(sunday, slots, [
      ex({
        kind: "open_special",
        start_date: sunday,
        end_date: sunday,
        start_time: "11:00",
        end_time: "15:00",
      }),
    ]);
    expect(result.windows).toEqual([{ start: "11:00", end: "15:00" }]);
  });

  it("subtracts a closed_time window, splitting the slot", () => {
    const result = getOpenWindowsForDate(MON, slots, [
      ex({ kind: "closed_time", start_time: "20:00", end_time: "21:00" }),
    ]);
    expect(result.windows).toEqual([
      { start: "12:00", end: "14:00" },
      { start: "19:00", end: "20:00" },
      { start: "21:00", end: "22:00" },
    ]);
  });

  it("merges overlapping base + special windows", () => {
    const result = getOpenWindowsForDate(MON, slots, [
      ex({ kind: "open_special", start_time: "13:00", end_time: "16:00" }),
    ]);
    expect(result.windows[0]).toEqual({ start: "12:00", end: "16:00" });
  });

  it("respects multi-day exception ranges", () => {
    const result = getOpenWindowsForDate(MON, slots, [
      ex({ start_date: "2026-06-20", end_date: "2026-06-26" }),
    ]);
    expect(result.closed).toBe(true);
  });
});

describe("isStartTimeAvailable", () => {
  it("accepts a time inside an open window", () => {
    expect(isStartTimeAvailable(MON, "19:30", slots, [])).toBe(true);
    expect(isStartTimeAvailable(MON, "12:00", slots, [])).toBe(true);
  });

  it("rejects a time at or after window close", () => {
    expect(isStartTimeAvailable(MON, "22:00", slots, [])).toBe(false);
    expect(isStartTimeAvailable(MON, "14:00", slots, [])).toBe(false);
  });

  it("rejects a time outside any window", () => {
    expect(isStartTimeAvailable(MON, "16:00", slots, [])).toBe(false);
  });

  it("rejects a time inside a closed_time block", () => {
    const result = isStartTimeAvailable(MON, "20:30", slots, [
      ex({ kind: "closed_time", start_time: "20:00", end_time: "21:00" }),
    ]);
    expect(result).toBe(false);
  });
});
