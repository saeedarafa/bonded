import { shortTime } from '@/features/push/ritual';

/** Word to type on 43 (board: "Type DELETE to confirm"). Not translated: it is the same everywhere. */
export const DELETE_WORD = 'DELETE';

/** Exactly DELETE, ignoring spaces around it (a keyboard's auto-space). Case matters. */
export function isDeleteConfirmed(typed: string): boolean {
  return typed.trim() === DELETE_WORD;
}

/**
 * Quiet hours choices on 41. The board shows the value only (no picker is designed, GAPS.md):
 * these windows all wrap midnight and never have start = end (CONTRACTS §2). 23:00–07:00 is the
 * server default (D23).
 */
export const QUIET_PRESETS = [
  { start: '21:00', end: '07:00' },
  { start: '22:00', end: '07:00' },
  { start: '23:00', end: '07:00' },
  { start: '23:00', end: '08:00' },
  { start: '00:00', end: '08:00' },
] as const;

export function quietKey(start: string, end: string): string {
  return `${shortTime(start)}-${shortTime(end)}`;
}

/** "23:00 – 07:00" (board 41). */
export function quietLabel(start: string, end: string): string {
  return `${shortTime(start)} – ${shortTime(end)}`;
}

/** "21 Oct" or "21 Oct 2026" for the Us header (40) and the partner card (42). */
export function shortDate(iso: string | null | undefined, withYear: boolean, locale?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(date);
}
