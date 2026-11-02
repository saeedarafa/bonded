import { parseInviteCode, parseInviteToken, usePendingInvite } from '../pendingInvite';

describe('parseInviteCode', () => {
  it.each([
    ['BND4827', '4827'],
    ['bnd·4827', '4827'],
    ['BND 4827', '4827'],
    ['BND-4827', '4827'],
    ['4827', '4827'],
  ])('%s → %s', (raw, digits) => {
    expect(parseInviteCode(raw)).toBe(digits);
  });

  it.each(['', 'BND', 'BND482', 'BND48271', 'ABC123', 'BND48a7', null, undefined])(
    '%p is not a code',
    (raw) => {
      expect(parseInviteCode(raw)).toBeNull();
    },
  );
});

describe('parseInviteToken', () => {
  it('accepts a url-safe 192-bit token', () => {
    const token = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
    expect(parseInviteToken(token)).toBe(token);
    expect(parseInviteToken([token])).toBe(token);
  });

  it.each([
    '',
    'short',
    'has space in it which is long enough....',
    '<script>alert(1)</script>',
    null,
  ])('drops %p', (raw) => {
    expect(parseInviteToken(raw)).toBeNull();
  });
});

describe('usePendingInvite', () => {
  it('keeps the invite in memory and clears it', () => {
    usePendingInvite.getState().set({ code: '4827', token: 't'.repeat(20), inviterName: 'Maya' });
    expect(usePendingInvite.getState()).toMatchObject({ code: '4827', inviterName: 'Maya' });
    usePendingInvite.getState().clear();
    expect(usePendingInvite.getState()).toMatchObject({
      code: null,
      token: null,
      inviterName: null,
    });
  });
});
