import { localDateKey } from '@/features/daily/today';
import type { HeatDay } from '@/ui';

/**
 * History (MOB-16, screens 29, 30, 53): pure date and heatmap logic, tested on its own.
 * Dates are the couple's local calendar dates as `YYYY-MM-DD` strings (`couple_questions.assigned_for`),
 * so no time zone maths happens after "what is today there".
 */

/** `2026-10`. */
export type MonthKey = string;

/** One daily question as the heatmap needs it (no text). */
export type DayRow = { assignedFor: string; answerCount: number };

export function monthOf(dateKey: string): MonthKey {
  return dateKey.slice(0, 7);
}

function parts(month: MonthKey): { y: number; m: number } {
  const [y, m] = month.split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1 };
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const { y, m } = parts(month);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First and last date of the month, its length and the weekday of the 1st (Monday = 0). */
export function monthRange(month: MonthKey): {
  start: string;
  end: string;
  days: number;
  firstWeekday: number;
} {
  const { y, m } = parts(month);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  return {
    start: `${month}-01`,
    end: `${month}-${String(days).padStart(2, '0')}`,
    days,
    firstWeekday,
  };
}

/**
 * The month grid (board 29), Monday first, padded to whole weeks.
 * - before the first question (`firstDay`) or after today: empty;
 * - today: its answer state with a pulsing ring (`today: true`); unanswered today is the outline;
 * - a past day: both (2 answers), one (1) or missed (0, or no row: the seed skips missed days).
 */
export function heatDays(input: {
  month: MonthKey;
  rows: readonly DayRow[];
  firstDay: string | null;
  today: string;
}): HeatDay[] {
  const { month, rows, firstDay, today } = input;
  const { days, firstWeekday } = monthRange(month);
  const counts = new Map<string, number>();
  for (const r of rows)
    counts.set(r.assignedFor, Math.max(counts.get(r.assignedFor) ?? 0, r.answerCount));

  const cells: HeatDay[] = [];
  for (let i = 0; i < firstWeekday; i++)
    cells.push({ key: `${month}-pad-${i}`, day: 0, state: 'empty' });
  for (let d = 1; d <= days; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const count = counts.get(key) ?? 0;
    if (!firstDay || key < firstDay || key > today) {
      cells.push({ key, day: d, state: 'empty' });
    } else if (key === today) {
      cells.push({
        key,
        day: d,
        state: count >= 2 ? 'both' : count === 1 ? 'one' : 'today',
        today: true,
      });
    } else {
      cells.push({ key, day: d, state: count >= 2 ? 'both' : count === 1 ? 'one' : 'missed' });
    }
  }
  while (cells.length % 7 !== 0)
    cells.push({ key: `${month}-end-${cells.length}`, day: 0, state: 'empty' });
  return cells;
}

/** Board 29 "N days together this month": days you both answered. */
export function monthCounts(cells: readonly HeatDay[]): {
  both: number;
  one: number;
  missed: number;
} {
  let both = 0;
  let one = 0;
  let missed = 0;
  for (const c of cells) {
    if (c.state === 'both') both += 1;
    else if (c.state === 'one') one += 1;
    else if (c.state === 'missed') missed += 1;
  }
  return { both, one, missed };
}

/** "October 2026". */
export function monthTitle(month: MonthKey, locale = 'en'): string {
  const { y, m } = parts(month);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "Oct 28" for a `YYYY-MM-DD` date. */
export function shortDate(dateKey: string, locale = 'en'): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** Board 30 "Day 8": the question's date counted from the day you got together (day 1), never below 1. */
export function dayOfBond(
  togetherSinceIso: string,
  assignedFor: string,
  timeZone: string | null | undefined,
): number {
  const start = localDateKey(new Date(togetherSinceIso), timeZone);
  const diff =
    (Date.parse(`${assignedFor}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return Math.max(1, Math.round(diff) + 1);
}

/**
 * Screen 53 "Your story starts today": nothing to look back on yet. Rows are the list's answered
 * questions (daily and pack); today's daily question only counts once you've both answered it.
 */
export function isHistoryEmpty(
  rows: readonly { assignedFor: string | null; answerCount: number }[],
  today: string,
): boolean {
  return !rows.some((r) =>
    r.assignedFor === null || r.assignedFor < today ? r.answerCount > 0 : r.answerCount >= 2,
  );
}
