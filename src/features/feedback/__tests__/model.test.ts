import {
  CHECK_IN_INTERVAL_MS,
  canSendFeedback,
  shouldOfferCheckIn,
  toggleTag,
} from '@/features/feedback/model';
import { createCheckInStore } from '@/features/feedback/checkIn';
import type { KeyValueStorage } from '@/lib/storage';

describe('27 tags', () => {
  it('toggles in board order', () => {
    expect(toggleTag([], 'something_else')).toEqual(['something_else']);
    expect(toggleTag(['something_else'], 'partner_forgets')).toEqual([
      'partner_forgets',
      'something_else',
    ]);
    expect(toggleTag(['partner_forgets', 'something_else'], 'partner_forgets')).toEqual([
      'something_else',
    ]);
  });

  it('sends with a tag or some text, not with nothing', () => {
    expect(canSendFeedback([], '')).toBe(false);
    expect(canSendFeedback([], '   ')).toBe(false);
    expect(canSendFeedback(['something_broke'], '')).toBe(true);
    expect(canSendFeedback([], 'hi')).toBe(true);
  });
});

describe('26 when to ask', () => {
  const NOW = Date.UTC(2026, 10, 10);
  const base = { bondedToday: true, day: 31, lastAskedAt: null, now: NOW, busy: false };

  it('asks from day 30 on a bonded day, when nothing else is open', () => {
    expect(shouldOfferCheckIn(base)).toBe(true);
    expect(shouldOfferCheckIn({ ...base, day: 30 })).toBe(true);
    expect(shouldOfferCheckIn({ ...base, day: 29 })).toBe(false);
    expect(shouldOfferCheckIn({ ...base, bondedToday: false })).toBe(false);
    expect(shouldOfferCheckIn({ ...base, busy: true })).toBe(false);
  });

  it('asks at most once every 30 days', () => {
    expect(shouldOfferCheckIn({ ...base, lastAskedAt: NOW - CHECK_IN_INTERVAL_MS + 1 })).toBe(
      false,
    );
    expect(shouldOfferCheckIn({ ...base, lastAskedAt: NOW - CHECK_IN_INTERVAL_MS })).toBe(true);
  });

  it('remembers when it asked, per user, across restarts', () => {
    const mem = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
    const a = createCheckInStore(storage);
    expect(a.getState().lastAskedAt('u1')).toBeNull();
    a.getState().markAsked('u1', NOW);
    const b = createCheckInStore(storage);
    expect(b.getState().lastAskedAt('u1')).toBe(NOW);
    expect(b.getState().lastAskedAt('u2')).toBeNull();
  });

  it('survives broken storage', () => {
    const broken: KeyValueStorage = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {},
    };
    const s = createCheckInStore(broken);
    expect(s.getState().lastAskedAt('u1')).toBeNull();
    expect(() => s.getState().markAsked('u1', NOW)).not.toThrow();
    expect(s.getState().lastAskedAt('u1')).toBe(NOW);
  });
});
