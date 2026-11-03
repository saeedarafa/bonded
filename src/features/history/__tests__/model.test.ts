import {
  dayOfBond,
  heatDays,
  isHistoryEmpty,
  monthCounts,
  monthRange,
  monthTitle,
  shiftMonth,
  shortDate,
  type DayRow,
} from '@/features/history/model';

/** Days before `today` (YYYY-MM-DD, UTC arithmetic). */
function offset(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The `history-month` scenario (supabase/seed.sql, qa/fixtures/personas.json) at its pinned clock
 * 2026-12-01: days -29..0 have a daily question, except the missed days -21 and -9 (no row at all);
 * -26, -17, -12 and -5 were answered by one person; every other day by both.
 */
const TODAY = '2026-12-01';
const SEEDED: DayRow[] = [];
for (let off = -29; off <= 0; off++) {
  if (off === -21 || off === -9) continue;
  SEEDED.push({
    assignedFor: offset(TODAY, off),
    answerCount: [-26, -17, -12, -5].includes(off) ? 1 : 2,
  });
}
const FIRST = offset(TODAY, -29);

describe('heatmap: history-month scenario (MOB-16 acceptance)', () => {
  it('November: 23 both, 4 one, 2 missed; Nov 1 is before the first question', () => {
    const cells = heatDays({ month: '2026-11', rows: SEEDED, firstDay: FIRST, today: TODAY });
    expect(monthCounts(cells)).toEqual({ both: 23, one: 4, missed: 2 });
    const byKey = new Map(cells.map((c) => [c.key, c]));
    expect(byKey.get('2026-11-01')?.state).toBe('empty');
    expect(byKey.get(offset(TODAY, -21))?.state).toBe('missed');
    expect(byKey.get(offset(TODAY, -9))?.state).toBe('missed');
    for (const off of [-26, -17, -12, -5]) expect(byKey.get(offset(TODAY, off))?.state).toBe('one');
    expect(byKey.get(offset(TODAY, -4))?.state).toBe('both');
  });

  it('December: today was answered by both and keeps its colour with the ring; later days empty', () => {
    const cells = heatDays({ month: '2026-12', rows: SEEDED, firstDay: FIRST, today: TODAY });
    const today = cells.find((c) => c.key === TODAY);
    expect(today).toMatchObject({ state: 'both', today: true });
    expect(cells.filter((c) => c.day > 1).every((c) => c.state === 'empty')).toBe(true);
    // 24 both-answered days in all (CONTRACT of the scenario): 23 in November + today.
    expect(monthCounts(cells).both).toBe(1);
  });

  it('the grid is Monday first and padded to whole weeks', () => {
    const cells = heatDays({ month: '2026-11', rows: SEEDED, firstDay: FIRST, today: TODAY });
    // 1 Nov 2026 is a Sunday: six empty cells first.
    expect(monthRange('2026-11').firstWeekday).toBe(6);
    expect(cells.slice(0, 6).every((c) => c.day === 0)).toBe(true);
    expect(cells[6]?.key).toBe('2026-11-01');
    expect(cells.length % 7).toBe(0);
  });
});

describe('heatmap: other days', () => {
  it('an unanswered today is the outline state; one answer today is "one" with the ring', () => {
    const none = heatDays({ month: '2026-12', rows: [], firstDay: TODAY, today: TODAY });
    expect(none.find((c) => c.key === TODAY)).toMatchObject({ state: 'today', today: true });
    const one = heatDays({
      month: '2026-12',
      rows: [{ assignedFor: TODAY, answerCount: 1 }],
      firstDay: TODAY,
      today: TODAY,
    });
    expect(one.find((c) => c.key === TODAY)).toMatchObject({ state: 'one', today: true });
  });

  it('a row with no answers in the past is missed; without any question everything is empty', () => {
    const cells = heatDays({
      month: '2026-11',
      rows: [{ assignedFor: '2026-11-30', answerCount: 0 }],
      firstDay: '2026-11-29',
      today: TODAY,
    });
    expect(cells.find((c) => c.key === '2026-11-30')?.state).toBe('missed');
    expect(cells.find((c) => c.key === '2026-11-29')?.state).toBe('missed');
    const blank = heatDays({ month: '2026-11', rows: [], firstDay: null, today: TODAY });
    expect(blank.every((c) => c.state === 'empty')).toBe(true);
  });
});

describe('dates', () => {
  it('months shift across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthRange('2028-02')).toMatchObject({
      start: '2028-02-01',
      end: '2028-02-29',
      days: 29,
    });
  });

  it('formats the month chip and row dates', () => {
    expect(monthTitle('2026-10')).toBe('October 2026');
    expect(shortDate('2026-10-28')).toBe('Oct 28');
  });

  it('Day N counts from the day you got together (day 1), never below 1', () => {
    expect(dayOfBond('2026-10-21T10:00:00Z', '2026-10-28', 'UTC')).toBe(8);
    expect(dayOfBond('2026-10-21T10:00:00Z', '2026-10-21', 'UTC')).toBe(1);
    expect(dayOfBond('2026-10-21T10:00:00Z', '2026-10-01', 'UTC')).toBe(1);
    // 23:30 in Berlin on the 20th is still the 20th there.
    expect(dayOfBond('2026-10-20T21:30:00Z', '2026-10-28', 'Europe/Berlin')).toBe(9);
  });
});

describe('53 empty history', () => {
  it('empty until something before today was answered, or today was answered by both', () => {
    expect(isHistoryEmpty([], TODAY)).toBe(true);
    expect(isHistoryEmpty([{ assignedFor: TODAY, answerCount: 1 }], TODAY)).toBe(true);
    expect(isHistoryEmpty([{ assignedFor: TODAY, answerCount: 2 }], TODAY)).toBe(false);
    expect(isHistoryEmpty([{ assignedFor: '2026-11-30', answerCount: 1 }], TODAY)).toBe(false);
    // A pack question (no assigned date) with an answer counts.
    expect(isHistoryEmpty([{ assignedFor: null, answerCount: 1 }], TODAY)).toBe(false);
  });
});
