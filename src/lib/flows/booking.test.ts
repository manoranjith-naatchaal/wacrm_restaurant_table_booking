import { describe, it, expect } from "vitest";
import {
  addDaysIso,
  dateButtonLabel,
  enumerateStartTimes,
  formatLongDate,
  formatTime12,
  getZonedNow,
  hasOpenTimeRemaining,
  sampleEvenly,
  shortDayLabel,
} from "./booking";

describe("getZonedNow", () => {
  it("resolves date + time in the target timezone", () => {
    // 11:30 IST on 2026-06-26 (06:00 UTC + 5:30).
    const base = new Date("2026-06-26T06:00:00Z");
    expect(getZonedNow("Asia/Kolkata", base)).toEqual({
      dateIso: "2026-06-26",
      time: "11:30",
    });
  });

  it("rolls the date forward when the zone is ahead of UTC", () => {
    // 20:00 UTC is already 01:30 the NEXT day in IST.
    const base = new Date("2026-06-26T20:00:00Z");
    expect(getZonedNow("Asia/Kolkata", base)).toEqual({
      dateIso: "2026-06-27",
      time: "01:30",
    });
  });

  it("falls back to UTC for an invalid timezone", () => {
    const base = new Date("2026-06-26T06:00:00Z");
    expect(getZonedNow("Not/AZone", base)).toEqual({
      dateIso: "2026-06-26",
      time: "06:00",
    });
  });
});

describe("addDaysIso", () => {
  it("adds a day within a month", () => {
    expect(addDaysIso("2026-06-26", 1)).toBe("2026-06-27");
  });
  it("rolls over month boundaries", () => {
    expect(addDaysIso("2026-06-30", 1)).toBe("2026-07-01");
  });
  it("rolls over year boundaries", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("shortDayLabel", () => {
  it("formats weekday + day, no timezone drift", () => {
    expect(shortDayLabel("2026-06-26")).toBe("Fri 26");
    expect(shortDayLabel("2026-06-27")).toBe("Sat 27");
  });
});

describe("formatTime12", () => {
  it("converts 24h to 12h with meridiem", () => {
    expect(formatTime12("19:30")).toBe("7:30 PM");
    expect(formatTime12("09:05")).toBe("9:05 AM");
    expect(formatTime12("00:00")).toBe("12:00 AM");
    expect(formatTime12("12:00")).toBe("12:00 PM");
  });
  it("accepts HH:MM:SS", () => {
    expect(formatTime12("17:00:00")).toBe("5:00 PM");
  });
  it("passes through unparseable input", () => {
    expect(formatTime12("nope")).toBe("nope");
  });
});

describe("enumerateStartTimes", () => {
  const lunch = [{ start: "17:00", end: "19:00" }];

  it("steps through a window, excluding the closing time", () => {
    expect(enumerateStartTimes(lunch, 30)).toEqual([
      "17:00",
      "17:30",
      "18:00",
      "18:30",
    ]);
  });

  it("drops times strictly before notBefore", () => {
    expect(enumerateStartTimes(lunch, 30, "18:00")).toEqual(["18:00", "18:30"]);
  });

  it("merges + de-duplicates across overlapping windows, sorted", () => {
    const windows = [
      { start: "18:00", end: "19:00" },
      { start: "17:00", end: "18:30" },
    ];
    expect(enumerateStartTimes(windows, 30)).toEqual([
      "17:00",
      "17:30",
      "18:00",
      "18:30",
    ]);
  });

  it("defaults a non-positive interval to 30 minutes", () => {
    expect(enumerateStartTimes(lunch, 0)).toEqual([
      "17:00",
      "17:30",
      "18:00",
      "18:30",
    ]);
  });
});

describe("dateButtonLabel", () => {
  const today = "2026-06-26"; // Friday
  it("labels today and tomorrow specially", () => {
    expect(dateButtonLabel("2026-06-26", today)).toBe("Today · Fri 26");
    expect(dateButtonLabel("2026-06-27", today)).toBe("Tomorrow · Sat 27");
  });
  it("labels further-out days with just the weekday + date", () => {
    expect(dateButtonLabel("2026-06-29", today)).toBe("Mon 29");
  });
});

describe("hasOpenTimeRemaining", () => {
  const windows = [{ start: "12:00", end: "15:00" }, { start: "19:00", end: "22:00" }];
  it("true when a window ends after now", () => {
    expect(hasOpenTimeRemaining(windows, "20:30")).toBe(true);
    expect(hasOpenTimeRemaining(windows, "13:00")).toBe(true);
  });
  it("false when every window has already ended", () => {
    expect(hasOpenTimeRemaining(windows, "22:00")).toBe(false);
    expect(hasOpenTimeRemaining(windows, "23:00")).toBe(false);
  });
});

describe("formatLongDate", () => {
  it("formats as D-Month-YYYY", () => {
    expect(formatLongDate("2026-06-20")).toBe("20-June-2026");
    expect(formatLongDate("2026-01-05")).toBe("5-January-2026");
    expect(formatLongDate("2026-12-31")).toBe("31-December-2026");
  });
  it("returns the input unchanged when not a valid iso date", () => {
    expect(formatLongDate("nope")).toBe("nope");
    expect(formatLongDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("sampleEvenly", () => {
  it("returns the list unchanged when within the cap", () => {
    expect(sampleEvenly(["a", "b", "c"], 5)).toEqual(["a", "b", "c"]);
    expect(sampleEvenly(["a", "b", "c"], 3)).toEqual(["a", "b", "c"]);
  });

  it("spreads across the whole range, always keeping first and last", () => {
    // 7am–9pm at 30-min steps → 28 candidates; capped to WhatsApp's 10
    // rows should still reach the evening, not stop at the morning.
    const times = enumerateStartTimes([{ start: "07:00", end: "21:00" }], 30);
    const picked = sampleEvenly(times, 10);
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe("07:00");
    expect(picked[picked.length - 1]).toBe("20:30");
    // Strictly increasing — no duplicates, order preserved.
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i] > picked[i - 1]).toBe(true);
    }
  });

  it("handles a zero/negative cap", () => {
    expect(sampleEvenly(["a", "b"], 0)).toEqual([]);
  });
});
