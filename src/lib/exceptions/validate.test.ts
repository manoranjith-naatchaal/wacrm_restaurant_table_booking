import { describe, expect, it } from 'vitest';

import { normalizeDate, validateExceptionInput } from './validate';

describe('normalizeDate', () => {
  it('accepts a real ISO date', () => {
    expect(normalizeDate('2026-06-20')).toBe('2026-06-20');
    expect(normalizeDate('  2026-12-31  ')).toBe('2026-12-31');
  });

  it('rejects malformed or impossible dates', () => {
    expect(normalizeDate('2026-6-2')).toBeNull();
    expect(normalizeDate('2026-02-31')).toBeNull();
    expect(normalizeDate('20-06-2026')).toBeNull();
    expect(normalizeDate('nope')).toBeNull();
    expect(normalizeDate(20260620)).toBeNull();
  });
});

describe('validateExceptionInput', () => {
  it('accepts a full-day closure and defaults end_date to start_date', () => {
    const result = validateExceptionInput({
      kind: 'closed_all_day',
      start_date: '2026-06-20',
      reason: 'Public holiday',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: 'closed_all_day',
        start_date: '2026-06-20',
        end_date: '2026-06-20',
        start_time: null,
        end_time: null,
        reason: 'Public holiday',
      });
    }
  });

  it('ignores any times sent with a full-day closure', () => {
    const result = validateExceptionInput({
      kind: 'closed_all_day',
      start_date: '2026-06-20',
      start_time: '13:00',
      end_time: '15:00',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.start_time).toBeNull();
      expect(result.value.end_time).toBeNull();
    }
  });

  it('accepts a timed closure window', () => {
    const result = validateExceptionInput({
      kind: 'closed_time',
      start_date: '2026-06-27',
      start_time: '13:00',
      end_time: '23:00',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.start_time).toBe('13:00');
      expect(result.value.end_time).toBe('23:00');
    }
  });

  it('accepts a multi-day range', () => {
    const result = validateExceptionInput({
      kind: 'closed_all_day',
      start_date: '2026-06-24',
      end_date: '2026-06-26',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.end_date).toBe('2026-06-26');
    }
  });

  it('requires times for timed kinds', () => {
    expect(
      validateExceptionInput({
        kind: 'closed_time',
        start_date: '2026-06-27',
      }).ok
    ).toBe(false);
    expect(
      validateExceptionInput({
        kind: 'open_special',
        start_date: '2026-06-27',
        start_time: '10:00',
      }).ok
    ).toBe(false);
  });

  it('rejects end_time not after start_time', () => {
    expect(
      validateExceptionInput({
        kind: 'closed_time',
        start_date: '2026-06-27',
        start_time: '15:00',
        end_time: '15:00',
      }).ok
    ).toBe(false);
  });

  it('rejects end_date before start_date', () => {
    expect(
      validateExceptionInput({
        kind: 'closed_all_day',
        start_date: '2026-06-26',
        end_date: '2026-06-24',
      }).ok
    ).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(
      validateExceptionInput({ kind: 'maybe', start_date: '2026-06-20' }).ok
    ).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateExceptionInput(null).ok).toBe(false);
    expect(validateExceptionInput('x').ok).toBe(false);
  });
});
