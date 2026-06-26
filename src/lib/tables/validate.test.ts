import { describe, expect, it } from 'vitest';

import { MAX_CAPACITY, MAX_LABEL_LENGTH, validateTableInput } from './validate';

describe('validateTableInput — create (full) mode', () => {
  it('accepts a minimal valid payload and applies defaults', () => {
    const result = validateTableInput({ label: 'T1', capacity: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        label: 'T1',
        capacity: 4,
        area: null,
        is_active: true,
        notes: null,
      });
    }
  });

  it('trims the label and collapses blank area/notes to null', () => {
    const result = validateTableInput({
      label: '  Window 4  ',
      capacity: 2,
      area: '   ',
      notes: '   ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label).toBe('Window 4');
      expect(result.value.area).toBeNull();
      expect(result.value.notes).toBeNull();
    }
  });

  it('rejects a missing or blank label', () => {
    expect(validateTableInput({ capacity: 4 }).ok).toBe(false);
    expect(validateTableInput({ label: '   ', capacity: 4 }).ok).toBe(false);
  });

  it('rejects a label longer than the max', () => {
    const result = validateTableInput({
      label: 'x'.repeat(MAX_LABEL_LENGTH + 1),
      capacity: 4,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-positive, non-integer, or oversized capacity', () => {
    expect(validateTableInput({ label: 'T1', capacity: 0 }).ok).toBe(false);
    expect(validateTableInput({ label: 'T1', capacity: -3 }).ok).toBe(false);
    expect(validateTableInput({ label: 'T1', capacity: 2.5 }).ok).toBe(false);
    expect(
      validateTableInput({ label: 'T1', capacity: MAX_CAPACITY + 1 }).ok
    ).toBe(false);
    expect(
      validateTableInput({ label: 'T1', capacity: '4' as unknown as number }).ok
    ).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateTableInput(null).ok).toBe(false);
    expect(validateTableInput('nope').ok).toBe(false);
    expect(validateTableInput(42).ok).toBe(false);
  });

  it('rejects non-boolean is_active', () => {
    expect(
      validateTableInput({
        label: 'T1',
        capacity: 4,
        is_active: 'yes' as unknown as boolean,
      }).ok
    ).toBe(false);
  });

  it('collects multiple errors at once', () => {
    const result = validateTableInput({ label: '', capacity: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('validateTableInput — partial (PATCH) mode', () => {
  it('validates only the provided fields', () => {
    const result = validateTableInput({ capacity: 6 }, { partial: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ capacity: 6 });
    }
  });

  it('still rejects an invalid present field', () => {
    expect(validateTableInput({ capacity: 0 }, { partial: true }).ok).toBe(
      false
    );
  });

  it('rejects an empty update (no recognised fields)', () => {
    expect(validateTableInput({}, { partial: true }).ok).toBe(false);
    expect(validateTableInput({ unknown: 1 }, { partial: true }).ok).toBe(
      false
    );
  });

  it('allows explicitly clearing an optional field to null', () => {
    const result = validateTableInput(
      { area: null, notes: null },
      { partial: true }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ area: null, notes: null });
    }
  });
});
