import {
  addDays,
  lovedTextAllowed,
  recapDays,
  weekDates,
  weekdayName,
  weekRangeLabel,
  weekStartOf,
} from '../model';

describe('weekly recap model (31)', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26'); // Sunday
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26'); // Monday
    expect(weekStartOf('2026-10-29')).toBe('2026-10-26'); // Thursday
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28'); // across a year
    expect(weekDates('2026-10-26')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('labels the range and the day like the board', () => {
    expect(weekRangeLabel('2026-10-26')).toBe('Oct 26 – Nov 1');
    expect(weekdayName('2026-10-29')).toBe('Thursday');
  });

  it('day states: both, one, missed, today and days still to come', () => {
    const days = recapDays({
      weekStart: '2026-10-26',
      today: '2026-10-29',
      days: [
        { assignedFor: '2026-10-26', answerCount: 2 },
        { assignedFor: '2026-10-27', answerCount: 1 },
        // 28: no question row at all = missed
        { assignedFor: '2026-10-29', answerCount: 0 },
        { assignedFor: '2026-10-30', answerCount: 2 }, // a future row never counts
      ],
    });
    expect(days.map((d) => d.state)).toEqual([
      'both',
      'one',
      'missed',
      'today',
      'later',
      'later',
      'later',
    ]);
    expect(
      recapDays({
        weekStart: '2026-10-26',
        today: '2026-10-29',
        days: [{ assignedFor: '2026-10-29', answerCount: 1 }],
      })[3]?.state,
    ).toBe('one');
  });

  it('reveal rule: text only where 30 shows it without a hold', () => {
    const today = '2026-11-01';
    const base = { today, revealedHere: false };
    expect(lovedTextAllowed({ ...base, source: 'daily', assignedFor: '2026-10-29' })).toBe(true);
    // Today's daily question: only after this device held to reveal.
    expect(lovedTextAllowed({ ...base, source: 'daily', assignedFor: today })).toBe(false);
    expect(
      lovedTextAllowed({ ...base, source: 'daily', assignedFor: today, revealedHere: true }),
    ).toBe(true);
    // A pack question (D13, MOB-49): only after the hold here.
    expect(lovedTextAllowed({ ...base, source: 'pack', assignedFor: null })).toBe(false);
    expect(
      lovedTextAllowed({ ...base, source: 'pack', assignedFor: null, revealedHere: true }),
    ).toBe(true);
    // Unknown source or no date: closed.
    expect(lovedTextAllowed({ ...base, source: 'unknown', assignedFor: '2026-10-29' })).toBe(false);
    expect(lovedTextAllowed({ ...base, source: 'daily', assignedFor: null })).toBe(false);
  });
});
