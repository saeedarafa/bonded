import type { Badge, BadgeAward } from '@/features/badges/api';
import {
  badgeTiles,
  CELEBRATE_WINDOW_MS,
  earnedStreakSteps,
  parseStep,
  pickCelebration,
  stepEarnedAt,
} from '@/features/badges/model';
import { createSeenStore } from '@/features/badges/seen';
import { memoryStorage } from '@/test/memoryStorage';

function badge(slug: string, threshold: number, extra: Partial<Badge> = {}): Badge {
  return {
    slug,
    threshold,
    kind: 'streak',
    owner: 'shared',
    title: slug,
    description: 'd',
    priority: 'P0',
    status: 'placeholder',
    ...extra,
  };
}

const CATALOGUE: Badge[] = [
  ...[1, 3, 7, 14, 21, 30, 50, 100, 365].map((n) => badge(`streak-${n}`, n)),
  badge('first-reveal', 1, { kind: 'achievement' }),
  badge('hearts-given', 25, { kind: 'achievement', owner: 'personal' }),
];

function award(slug: string, awardedAt: string, extra: Partial<BadgeAward> = {}): BadgeAward {
  return {
    id: `id-${slug}`,
    badge_slug: slug,
    couple_id: 'c1',
    user_id: null,
    awarded_at: awardedAt,
    ...extra,
  };
}

const NOW = new Date('2026-11-03T12:00:00Z');

describe('badge model (MOB-17)', () => {
  it('reads earned streak steps from awards only', () => {
    const awards = [
      award('streak-3', '2026-11-02T10:00:00Z'),
      award('streak-1', '2026-11-01T10:00:00Z'),
      award('first-reveal', '2026-11-01T10:00:00Z'),
      award('unknown', '2026-11-01T10:00:00Z'),
    ];
    expect(earnedStreakSteps(awards, CATALOGUE)).toEqual([1, 3]);
  });

  it('lists earned badges newest first, then streak badges ahead; colours follow the owner', () => {
    const tiles = badgeTiles({
      catalogue: CATALOGUE,
      awards: [
        award('streak-1', '2026-10-21T10:00:00Z'),
        award('streak-7', '2026-10-27T10:00:00Z'),
        award('first-reveal', '2026-10-22T10:00:00Z'),
        award('hearts-given', '2026-10-30T10:00:00Z', { couple_id: null, user_id: 'u1' }),
      ],
      current: 12,
      userId: 'u1',
    });
    expect(tiles.map((x) => `${x.slug}:${x.state}:${x.tone}`)).toEqual([
      'hearts-given:earned:you',
      'streak-7:earned:shared',
      'first-reveal:earned:shared',
      'streak-1:earned:shared',
      // streak-3 has no award (it predates BE-12): still ahead, but the next one is 14.
      'streak-3:locked:shared',
      'streak-14:next:shared',
      'streak-21:locked:shared',
      'streak-30:locked:shared',
      'streak-50:locked:shared',
      'streak-100:locked:shared',
      'streak-365:locked:shared',
    ]);
    // Achievements are only shown once awarded.
    expect(
      badgeTiles({ catalogue: CATALOGUE, awards: [], current: 0, userId: 'u1' }).some(
        (x) => x.kind === 'achievement',
      ),
    ).toBe(false);
  });

  it("colours a partner's personal badge sky", () => {
    const [tile] = badgeTiles({
      catalogue: CATALOGUE,
      awards: [award('hearts-given', '2026-10-30T10:00:00Z', { couple_id: null, user_id: 'u2' })],
      current: 0,
      userId: 'u1',
    });
    expect(tile?.tone).toBe('partner');
  });

  it('celebrates the highest new streak award: 7/30/100 as the milestone, others as the sheet', () => {
    const awards = [
      award('streak-1', '2026-11-03T08:00:00Z'),
      award('streak-3', '2026-11-03T08:00:00Z'),
    ];
    expect(pickCelebration({ awards, catalogue: CATALOGUE, seen: [], now: NOW })).toEqual({
      days: 3,
      kind: 'sheet',
      awardIds: ['id-streak-1', 'id-streak-3'],
    });
    expect(
      pickCelebration({
        awards: [award('streak-30', '2026-11-03T08:00:00Z')],
        catalogue: CATALOGUE,
        seen: [],
        now: NOW,
      })?.kind,
    ).toBe('milestone');
  });

  it('never replays a seen award or celebrates an old one', () => {
    const awards = [award('streak-7', '2026-11-03T08:00:00Z')];
    expect(
      pickCelebration({ awards, catalogue: CATALOGUE, seen: ['id-streak-7'], now: NOW }),
    ).toBeNull();
    const old = new Date(NOW.getTime() - CELEBRATE_WINDOW_MS - 1).toISOString();
    expect(
      pickCelebration({
        awards: [award('streak-7', old)],
        catalogue: CATALOGUE,
        seen: [],
        now: NOW,
      }),
    ).toBeNull();
    // Achievements have no celebration of their own (52b is the streak sheet).
    expect(
      pickCelebration({
        awards: [award('first-reveal', '2026-11-03T08:00:00Z')],
        catalogue: CATALOGUE,
        seen: [],
        now: NOW,
      }),
    ).toBeNull();
  });

  it('celebrates only the last 48 h (MOB-41)', () => {
    expect(CELEBRATE_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const pick = (awardedAt: string) =>
      pickCelebration({
        awards: [award('streak-7', awardedAt)],
        catalogue: CATALOGUE,
        seen: [],
        now: NOW,
      });
    expect(pick(at(CELEBRATE_WINDOW_MS))?.days).toBe(7);
    expect(pick(at(CELEBRATE_WINDOW_MS + 1))).toBeNull();
    expect(pick(at(7 * 24 * 60 * 60 * 1000))).toBeNull();
  });

  it('dates a step by the current run when the award was written later (MOB-41)', () => {
    const now = NOW.toISOString();
    // A run of 11 last completed on 2026-11-03: 7 was reached on 2026-10-30.
    expect(stepEarnedAt(now, 7, { current: 11, lastCompletedOn: '2026-11-03' })).toBe(
      Date.parse('2026-10-31T00:00:00Z'),
    );
    // Reached on the last completed day: the award time stands when it is earlier.
    expect(stepEarnedAt(now, 11, { current: 11, lastCompletedOn: '2026-11-03' })).toBe(
      NOW.getTime(),
    );
    // Not in the current run (or no run): only awarded_at counts.
    expect(stepEarnedAt(now, 14, { current: 11, lastCompletedOn: '2026-11-03' })).toBe(
      NOW.getTime(),
    );
    expect(stepEarnedAt(now, 7, null)).toBe(NOW.getTime());
    expect(stepEarnedAt(now, 7, { current: 11, lastCompletedOn: null })).toBe(NOW.getTime());
    const awards = [award('streak-7', now), award('streak-3', now)];
    expect(
      pickCelebration({
        awards,
        catalogue: CATALOGUE,
        seen: [],
        now: NOW,
        streak: { current: 11, lastCompletedOn: '2026-11-03' },
      }),
    ).toBeNull();
    expect(
      pickCelebration({
        awards: [award('streak-7', now)],
        catalogue: CATALOGUE,
        seen: [],
        now: NOW,
        streak: { current: 7, lastCompletedOn: '2026-11-03' },
      })?.kind,
    ).toBe('milestone');
  });

  it('accepts only streak steps as /milestone/[n]', () => {
    expect(parseStep('30')).toBe(30);
    expect(parseStep(['7'])).toBe(7);
    expect(parseStep('8')).toBeNull();
    expect(parseStep('7.0')).toBeNull();
    expect(parseStep(undefined)).toBeNull();
  });

  it('remembers seen awards on the device', () => {
    const storage = memoryStorage();
    const store = createSeenStore(storage);
    store.getState().markSeen(['a', 'b']);
    store.getState().markSeen(['b']);
    expect(createSeenStore(storage).getState().seen).toEqual(['a', 'b']);
  });
});
