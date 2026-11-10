import type { DayRow } from '@/features/history/model';

/**
 * Weekly recap (31, MOB-21 part 2) as plain functions: the couple-local week, the seven day
 * states for the mascot strip, and when the most-loved answer's text may show (reveal rule).
 */

function toUtc(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` plus `n` calendar days. */
export function addDays(dateKey: string, n: number): string {
  const date = toUtc(dateKey);
  date.setUTCDate(date.getUTCDate() + n);
  return toKey(date);
}

/** The Monday of the week holding `dateKey` (weeks run Monday to Sunday, like BE-14). */
export function weekStartOf(dateKey: string): string {
  const day = toUtc(dateKey).getUTCDay(); // 0 = Sunday
  return addDays(dateKey, -((day + 6) % 7));
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * One day of the strip. `both` / `one` / `missed` mirror the heatmap (29); `today` is today
 * while neither has answered yet, `later` a day still to come.
 */
export type RecapDayState = 'both' | 'one' | 'missed' | 'today' | 'later';

export type RecapDay = { date: string; state: RecapDayState };

export function recapDays(input: { weekStart: string; today: string; days: readonly DayRow[] }) {
  const counts = new Map(input.days.map((d) => [d.assignedFor, d.answerCount]));
  return weekDates(input.weekStart).map((date): RecapDay => {
    if (date > input.today) return { date, state: 'later' };
    const n = counts.get(date) ?? 0;
    if (n >= 2) return { date, state: 'both' };
    if (n === 1) return { date, state: 'one' };
    return { date, state: date === input.today ? 'today' : 'missed' };
  });
}

/**
 * The reveal rule on 31: the most-loved answer's text shows only where 30 would show it without
 * a hold. A pack question needs this device's hold (D13, MOB-49); today's daily question too
 * (Today's 20 has not been held here yet). An earlier daily question is open, as on 30.
 */
export function lovedTextAllowed(input: {
  source: string;
  assignedFor: string | null;
  today: string;
  revealedHere: boolean;
}): boolean {
  if (input.revealedHere) return true;
  if (input.source !== 'daily') return false;
  return input.assignedFor !== null && input.assignedFor < input.today;
}

/** "Oct 26 – Nov 1" for the week starting on `weekStart`. */
export function weekRangeLabel(weekStart: string, locale = 'en'): string {
  const f = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f.format(toUtc(weekStart))} – ${f.format(toUtc(addDays(weekStart, 6)))}`;
}

/** "Thursday" for a date key. */
export function weekdayName(dateKey: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    toUtc(dateKey),
  );
}

/** "T" for a date key (the strip's day letter). */
export function weekdayLetter(dateKey: string, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
    toUtc(dateKey),
  );
}
