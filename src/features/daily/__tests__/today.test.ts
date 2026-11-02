import {
  dayNumber,
  formatCountdown,
  normalizeStreak,
  secondsUntilNextQuestion,
  todayState,
  togetherSince,
  type Streak,
} from '@/features/daily/today';

const streak = (over: Partial<Streak> = {}): Streak => ({ ...normalizeStreak(null), ...over });

describe('normalizeStreak', () => {
  it('treats the null completed_today of an empty history as false (QA-BUG-3)', () => {
    expect(
      normalizeStreak({
        current: 0,
        longest: 0,
        last_completed_on: null,
        completed_today: null,
        at_risk: null,
        saver_available: null,
      }),
    ).toEqual({
      current: 0,
      longest: 0,
      lastCompletedOn: null,
      completedToday: false,
      atRisk: false,
      saverAvailable: false,
    });
  });

  it('keeps the live values', () => {
    expect(
      normalizeStreak({
        current: 11,
        longest: 41,
        last_completed_on: '2026-11-01',
        completed_today: true,
        at_risk: false,
        saver_available: false,
      }),
    ).toMatchObject({ current: 11, longest: 41, completedToday: true });
  });
});

describe('todayState (seeded personas)', () => {
  const paired = { partnerJoined: true };

  it('streak-11-your-turn: Maya (Sam answered) is on 18, Sam is on 23', () => {
    const s = streak({ current: 11, longest: 11, lastCompletedOn: '2026-11-01' });
    expect(todayState({ ...paired, answeredByMe: false, answerCount: 1, streak: s })).toBe(
      'yourTurn',
    );
    expect(todayState({ ...paired, answeredByMe: true, answerCount: 1, streak: s })).toBe(
      'waiting',
    );
  });

  it('streak-11-both-answered: 24 for both', () => {
    const s = streak({ current: 12, completedToday: true, lastCompletedOn: '2026-11-02' });
    expect(todayState({ ...paired, answeredByMe: true, answerCount: 2, streak: s })).toBe('bonded');
  });

  it('missed-day-napping: 28 until someone answers today', () => {
    const s = streak({ current: 0, longest: 41, lastCompletedOn: '2026-10-31' });
    expect(todayState({ ...paired, answeredByMe: false, answerCount: 0, streak: s })).toBe(
      'napping',
    );
    // The partner woke them: it's my turn again.
    expect(todayState({ ...paired, answeredByMe: false, answerCount: 1, streak: s })).toBe(
      'yourTurn',
    );
    expect(todayState({ ...paired, answeredByMe: true, answerCount: 1, streak: s })).toBe(
      'waiting',
    );
  });

  it('a brand-new couple (no history) is never napping', () => {
    const s = streak();
    expect(todayState({ ...paired, answeredByMe: false, answerCount: 0, streak: s })).toBe(
      'yourTurn',
    );
  });

  it('solo (partner not joined) is your turn, then waiting', () => {
    const s = streak({ lastCompletedOn: '2026-10-01' });
    expect(
      todayState({ partnerJoined: false, answeredByMe: false, answerCount: 0, streak: s }),
    ).toBe('yourTurn');
    expect(
      todayState({ partnerJoined: false, answeredByMe: true, answerCount: 1, streak: s }),
    ).toBe('waiting');
  });
});

describe('countdown', () => {
  it('counts to local midnight in the couple timezone', () => {
    // 10:00 UTC = 11:00 in Berlin (CET) = 05:00 in New York (EST).
    const now = new Date('2026-11-02T10:00:00Z');
    expect(secondsUntilNextQuestion(now, 'Europe/Berlin')).toBe(13 * 3600);
    expect(secondsUntilNextQuestion(now, 'America/New_York')).toBe(19 * 3600);
    expect(secondsUntilNextQuestion(now, 'UTC')).toBe(14 * 3600);
  });

  it('formats as HH:MM:SS with leading zeros', () => {
    expect(formatCountdown(51729)).toBe('14:22:09');
    expect(formatCountdown(5)).toBe('00:00:05');
    expect(formatCountdown(-3)).toBe('00:00:00');
  });
});

describe('dayNumber', () => {
  it('counts today as day N in the couple timezone', () => {
    const now = new Date('2026-11-02T10:00:00Z');
    expect(dayNumber('2026-10-22T10:00:00Z', now, 'UTC')).toBe(12);
    expect(dayNumber('2026-11-02T01:00:00Z', now, 'UTC')).toBe(1);
    // 23:30 UTC on 1 Nov is already 2 Nov in Berlin: still day 1 there.
    expect(dayNumber('2026-11-01T23:30:00Z', now, 'Europe/Berlin')).toBe(1);
  });

  it('counts from paired_at, falling back to created_at while solo', () => {
    const created = '2026-10-01T10:00:00Z';
    expect(togetherSince({ paired_at: '2026-10-22T10:00:00Z', created_at: created })).toBe(
      '2026-10-22T10:00:00Z',
    );
    expect(togetherSince({ paired_at: null, created_at: created })).toBe(created);
  });
});
