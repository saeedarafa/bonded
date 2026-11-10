import type { EndedCouple } from '@/features/settings/api';
import {
  DELETE_WORD,
  isDeleteConfirmed,
  QUIET_PRESETS,
  quietKey,
  quietLabel,
  shortDate,
} from '@/features/settings/model';
import {
  createEndedSeenStore,
  formerPartnerId,
  partnerLeftCouple,
} from '@/features/settings/partnerLeft';
import { memoryStorage } from '@/test/memoryStorage';

describe('isDeleteConfirmed (43)', () => {
  it.each([
    ['DELETE', true],
    [' DELETE ', true],
    ['delete', false],
    ['Delete', false],
    ['DELET', false],
    ['DELETE!', false],
    ['', false],
  ])('%j -> %s', (typed, ok) => expect(isDeleteConfirmed(typed)).toBe(ok));

  it('is the word on the board', () => expect(DELETE_WORD).toBe('DELETE'));
});

describe('quiet hours (41, D24)', () => {
  it('labels and keys ignore seconds from Postgres `time`', () => {
    expect(quietLabel('23:00:00', '07:00:00')).toBe('23:00 – 07:00');
    expect(quietKey('23:00:00', '07:00')).toBe('23:00-07:00');
  });

  it('presets never start and end at the same time and include the default', () => {
    for (const p of QUIET_PRESETS) expect(p.start).not.toBe(p.end);
    expect(QUIET_PRESETS.map((p) => quietKey(p.start, p.end))).toContain('23:00-07:00');
  });
});

describe('shortDate', () => {
  it('formats with and without the year, null for nothing', () => {
    expect(shortDate('2026-10-21T10:00:00Z', false, 'en-GB')).toBe('21 Oct');
    expect(shortDate('2026-10-21T10:00:00Z', true, 'en-GB')).toBe('21 Oct 2026');
    expect(shortDate(null, true)).toBeNull();
    expect(shortDate('not a date', true)).toBeNull();
  });
});

const ENDED: EndedCouple = {
  id: 'c-old',
  ended_at: '2026-11-09T10:00:00Z',
  paired_at: '2026-10-21T10:00:00Z',
  couple_members: [
    { user_id: 'u1', left_at: '2026-11-09T10:00:00Z' },
    { user_id: 'u2', left_at: '2026-11-09T10:00:00Z' },
  ],
};

describe('partner left (58)', () => {
  it('tells me about an ended couple that had a partner, once', () => {
    expect(partnerLeftCouple(ENDED, [])).toBe(ENDED);
    expect(partnerLeftCouple(ENDED, ['c-old'])).toBeNull();
    expect(partnerLeftCouple(null, [])).toBeNull();
    expect(partnerLeftCouple(undefined, [])).toBeNull();
  });

  it('never for a solo space that was archived (no partner ever joined)', () => {
    expect(partnerLeftCouple({ ...ENDED, paired_at: null }, [])).toBeNull();
  });

  it('finds the former partner, or none after they deleted their account', () => {
    expect(formerPartnerId(ENDED, 'u1')).toBe('u2');
    expect(formerPartnerId({ ...ENDED, couple_members: [ENDED.couple_members[0]!] }, 'u1')).toBe(
      null,
    );
    expect(formerPartnerId(null, 'u1')).toBeNull();
  });

  it('remembers seen couples on the device, and forgets one on a failed unpair', () => {
    const storage = memoryStorage();
    const store = createEndedSeenStore(storage);
    store.getState().markSeen('a');
    store.getState().markSeen('a');
    store.getState().markSeen('b');
    expect(store.getState().seen).toEqual(['a', 'b']);
    expect(createEndedSeenStore(storage).getState().seen).toEqual(['a', 'b']);
    store.getState().unmark('a');
    expect(createEndedSeenStore(storage).getState().seen).toEqual(['b']);
  });

  it('survives unreadable storage', () => {
    const storage = memoryStorage();
    storage.setItem('seen', '{not json');
    expect(createEndedSeenStore(storage).getState().seen).toEqual([]);
  });
});
