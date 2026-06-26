import { describe, expect, it } from 'vitest';

import { normalizeTime, validateSlotInput } from './validate';

const base = {
  day_of_week: 1,
  start_time: '19:00',
  end_time: '21:00',
};

describe('normalizeTime', () => {
  it('accepts HH:MM and strips seconds from HH:MM:SS', () => {
    expect(normalizeTime('09:30')).toBe('09:30');
    expect(normalizeTime('19:00:00')).toBe('19:00');
    expect(normalizeTime('  08:15  ')).toBe('08:15');
  });

  it('rejects malformed or out-of-range times', () => {
    expect(normalizeTime('9:30')).toBeNull();
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('12:60')).toBeNull();
    expect(normalizeTime('noon')).toBeNull();
    expect(normalizeTime(900)).toBeNull();
  });
});

describe('validateSlotInput — create (full) mode', () => {
  it('accepts a valid slot and defaults is_active to true', () => {
    const result = validateSlotInput(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ...base, is_active: true });
    }
  });

  it('rejects an out-of-range day_of_week', () => {
    expect(validateSlotInput({ ...base, day_of_week: 7 }).ok).toBe(false);
    expect(validateSlotInput({ ...base, day_of_week: -1 }).ok).toBe(false);
    expect(validateSlotInput({ ...base, day_of_week: 1.5 }).ok).toBe(false);
  });

  it('rejects invalid times', () => {
    expect(validateSlotInput({ ...base, start_time: '7pm' }).ok).toBe(false);
    expect(validateSlotInput({ ...base, end_time: '25:00' }).ok).toBe(false);
  });

  it('rejects end_time not after start_time', () => {
    expect(
      validateSlotInput({ ...base, start_time: '21:00', end_time: '21:00' }).ok
    ).toBe(false);
    expect(
      validateSlotInput({ ...base, start_time: '21:00', end_time: '19:00' }).ok
    ).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateSlotInput(null).ok).toBe(false);
    expect(validateSlotInput('x').ok).toBe(false);
  });
});

describe('validateSlotInput — partial (PATCH) mode', () => {
  it('validates only provided fields', () => {
    const result = validateSlotInput({ is_active: false }, { partial: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ is_active: false });
    }
  });

  it('checks ordering only when both times are present', () => {
    expect(
      validateSlotInput({ start_time: '20:00' }, { partial: true }).ok
    ).toBe(true);
    expect(
      validateSlotInput(
        { start_time: '20:00', end_time: '19:00' },
        { partial: true }
      ).ok
    ).toBe(false);
  });

  it('rejects an empty update', () => {
    expect(validateSlotInput({}, { partial: true }).ok).toBe(false);
  });
});
