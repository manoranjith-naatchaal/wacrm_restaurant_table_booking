import { describe, expect, it } from 'vitest';

import { validateGuestInput } from './validate';

const uuid = '11111111-2222-3333-4444-555555555555';

describe('validateGuestInput — create mode', () => {
  it('accepts a minimal guest and applies defaults', () => {
    const result = validateGuestInput({ name: '  Jane Doe  ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: 'Jane Doe',
        is_vip: false,
        tags: [],
      });
    }
  });

  it('requires a name', () => {
    expect(validateGuestInput({}).ok).toBe(false);
    expect(validateGuestInput({ name: '   ' }).ok).toBe(false);
  });

  it('accepts a full guest', () => {
    const result = validateGuestInput({
      name: 'VIP Guest',
      contact_id: uuid,
      phone: '+1 555 0100',
      email: 'vip@example.com',
      is_vip: true,
      dietary_notes: 'Nut allergy',
      notes: 'Window seat preferred',
      tags: ['regular', 'wine-club'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contact_id).toBe(uuid);
      expect(result.value.is_vip).toBe(true);
      expect(result.value.tags).toEqual(['regular', 'wine-club']);
    }
  });

  it('rejects an invalid email', () => {
    expect(validateGuestInput({ name: 'X', email: 'not-an-email' }).ok).toBe(
      false
    );
  });

  it('rejects an invalid contact_id', () => {
    expect(validateGuestInput({ name: 'X', contact_id: 'nope' }).ok).toBe(
      false
    );
  });

  it('treats empty optional strings as null', () => {
    const result = validateGuestInput({
      name: 'X',
      phone: '',
      email: '',
      dietary_notes: '',
      contact_id: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phone).toBeNull();
      expect(result.value.email).toBeNull();
      expect(result.value.dietary_notes).toBeNull();
      expect(result.value.contact_id).toBeNull();
    }
  });

  it('trims, dedupes (case-insensitive), and drops empty tags', () => {
    const result = validateGuestInput({
      name: 'X',
      tags: [' Regular ', 'regular', '', 'VIP'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tags).toEqual(['Regular', 'VIP']);
    }
  });
});

describe('validateGuestInput — partial mode', () => {
  it('allows updating a single field', () => {
    const result = validateGuestInput({ is_vip: true }, { partial: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ is_vip: true });
    }
  });

  it('does not require name when omitted', () => {
    expect(validateGuestInput({ notes: 'hi' }, { partial: true }).ok).toBe(
      true
    );
  });

  it('still rejects a blank name when provided', () => {
    expect(validateGuestInput({ name: '' }, { partial: true }).ok).toBe(false);
  });

  it('rejects an empty update', () => {
    expect(validateGuestInput({}, { partial: true }).ok).toBe(false);
  });
});
