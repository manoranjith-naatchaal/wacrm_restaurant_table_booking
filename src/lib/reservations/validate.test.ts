import { describe, expect, it } from "vitest";

import { validateReservationInput } from "./validate";

const guestId = "11111111-2222-3333-4444-555555555555";
const tableId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const base = {
  guest_id: guestId,
  reservation_date: "2026-06-22",
  start_time: "19:00",
  party_size: 4,
};

describe("validateReservationInput — create mode", () => {
  it("accepts a minimal reservation and defaults status to pending", () => {
    const result = validateReservationInput(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
      expect(result.value.guest_id).toBe(guestId);
    }
  });

  it("requires a valid guest", () => {
    expect(validateReservationInput({ ...base, guest_id: "nope" }).ok).toBe(
      false,
    );
    const noGuest: Record<string, unknown> = { ...base };
    delete noGuest.guest_id;
    expect(validateReservationInput(noGuest).ok).toBe(false);
  });

  it("accepts a full reservation", () => {
    const result = validateReservationInput({
      ...base,
      table_id: tableId,
      end_time: "21:00",
      status: "confirmed",
      notes: "Anniversary",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.table_id).toBe(tableId);
      expect(result.value.end_time).toBe("21:00");
      expect(result.value.status).toBe("confirmed");
    }
  });

  it("rejects end_time not after start_time", () => {
    expect(
      validateReservationInput({ ...base, end_time: "19:00" }).ok,
    ).toBe(false);
    expect(
      validateReservationInput({ ...base, end_time: "18:00" }).ok,
    ).toBe(false);
  });

  it("rejects a bad date or time", () => {
    expect(
      validateReservationInput({ ...base, reservation_date: "2026-13-01" }).ok,
    ).toBe(false);
    expect(validateReservationInput({ ...base, start_time: "25:00" }).ok).toBe(
      false,
    );
  });

  it("rejects an invalid party size", () => {
    expect(validateReservationInput({ ...base, party_size: 0 }).ok).toBe(false);
    expect(validateReservationInput({ ...base, party_size: 2.5 }).ok).toBe(
      false,
    );
  });

  it("rejects an invalid status", () => {
    expect(validateReservationInput({ ...base, status: "maybe" }).ok).toBe(
      false,
    );
  });

  it("treats empty table_id as null (unassigned)", () => {
    const result = validateReservationInput({ ...base, table_id: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.table_id).toBeNull();
  });
});

describe("validateReservationInput — partial mode", () => {
  it("allows a status-only update", () => {
    const result = validateReservationInput(
      { status: "seated" },
      { partial: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ status: "seated" });
  });

  it("does not require guest when omitted", () => {
    expect(
      validateReservationInput({ party_size: 6 }, { partial: true }).ok,
    ).toBe(true);
  });

  it("rejects an empty update", () => {
    expect(validateReservationInput({}, { partial: true }).ok).toBe(false);
  });
});
