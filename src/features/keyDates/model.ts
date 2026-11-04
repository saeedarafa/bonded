import type { Database } from '@/types/database';

/** `key_date_kind` (CONTRACTS §2, BE-03). */
export type KeyDateKind = Database['public']['Enums']['key_date_kind'];

/**
 * What screen 47 lets the person set: the couple's two dates and **their own** birthday. The
 * partner's birthday is never set here: RLS lets each member write only their own (the partner
 * adds it themselves).
 */
export const ONBOARDING_KEY_DATES = ['together_since', 'anniversary', 'birthday'] as const;
export type OnboardingKeyDate = (typeof ONBOARDING_KEY_DATES)[number];

/** ISO calendar dates (`YYYY-MM-DD`), one per kind; a missing kind was left empty. */
export type KeyDateValues = Partial<Record<OnboardingKeyDate, string>>;

/** What a date field holds while typing: digits only, possibly incomplete. */
export type DateParts = { year: string; month: string; day: string };

export const EMPTY_PARTS: DateParts = { year: '', month: '', day: '' };

/** Earliest year accepted (a birthday or "together since"). */
export const MIN_YEAR = 1900;

export type DateCheck =
  | { status: 'empty' }
  | { status: 'ok'; iso: string }
  | { status: 'incomplete' | 'invalid' | 'future' };

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** Today's calendar date on this device, as `YYYY-MM-DD`. */
export function localIsoDate(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/**
 * Validates a typed date: all three parts or none; a real calendar day (no 31 April, 29 February
 * only in leap years); from 1900 up to today (every key date has already happened).
 */
export function checkDate(parts: DateParts, today: string): DateCheck {
  const y = parts.year.trim();
  const m = parts.month.trim();
  const d = parts.day.trim();
  if (!y && !m && !d) return { status: 'empty' };
  if (!y || !m || !d) return { status: 'incomplete' };
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) {
    return { status: 'invalid' };
  }
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1) return { status: 'invalid' };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return { status: 'invalid' };
  const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  if (iso > today) return { status: 'future' };
  return { status: 'ok', iso };
}

/** `2023-03-14` back into the field's parts (for editing a saved date). */
export function partsFromIso(iso: string | undefined): DateParts {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return EMPTY_PARTS;
  return { year: m[1] ?? '', month: m[2] ?? '', day: m[3] ?? '' };
}

/**
 * A short label for a row ("May 9"; with the year when `withYear`). Formatted in UTC so the
 * calendar date never shifts with the device timezone.
 */
export function formatKeyDate(iso: string, locale: string, withYear = false): string {
  const [y = NaN, m = NaN, d = NaN] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return iso;
  }
}

export type KeyDateRow = Database['public']['Tables']['key_dates']['Insert'];

/**
 * The `key_dates` upsert payload (CONTRACTS §2). `user_id` is always present (null for the couple's
 * dates) so the bulk upsert has one column set and matches `onConflict: 'couple_id,kind,user_id'`.
 * A birthday is written only for the signed-in member.
 */
export function keyDateRows(input: {
  coupleId: string;
  userId: string;
  dates: KeyDateValues;
  remindWeekBefore: boolean;
}): KeyDateRow[] {
  return ONBOARDING_KEY_DATES.flatMap((kind) => {
    const date = input.dates[kind];
    if (!date) return [];
    return [
      {
        couple_id: input.coupleId,
        kind,
        user_id: kind === 'birthday' ? input.userId : null,
        date,
        remind_week_before: input.remindWeekBefore,
      },
    ];
  });
}
