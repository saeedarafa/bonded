/**
 * MOB-50 (D08, D09): my latest ended couple's History stays readable for 30 days after it ended.
 * The server enforces the window (`private.can_read_couple`: `ended_at >= now() - 30 days`, then
 * the daily purge); the app only hides the entry once the window has passed, so a cached couple
 * never offers a door that RLS would answer with nothing. Pure, so it is unit tested on its own.
 */

/** D08: how long a former member can read an ended couple. */
export const ENDED_HISTORY_DAYS = 30;
const DAY_MS = 86_400_000;

/** When the archive closes (ended_at + 30 days), or null when the end time is unknown. */
export function endedHistoryUntil(endedAt: string | null | undefined): Date | null {
  const ended = Date.parse(endedAt ?? '');
  if (Number.isNaN(ended)) return null;
  return new Date(ended + ENDED_HISTORY_DAYS * DAY_MS);
}

/** True while the ended couple's History may be shown: it had a partner and the window is open. */
export function isEndedHistoryOpen(
  ended: { ended_at: string | null; paired_at: string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!ended || !ended.paired_at) return false;
  const until = endedHistoryUntil(ended.ended_at);
  return until !== null && now.getTime() < until.getTime();
}

/** One question of the archive list: ids and counts only, no answer text. */
export type EndedRow = {
  id: string;
  source: string;
  assignedFor: string | null;
  createdAt: string;
  question: string;
  /** Whose answers RLS lets me see: mine always; my partner's only if I answered too. */
  answeredBy: string[];
  replies: number;
  /** D55 (MOB-71): older than yesterday and I have no Premium of my own: listed, content closed. */
  locked?: boolean;
};

/**
 * The questions worth opening: the ones I answered (D09: I keep my own answers). A question only
 * my partner answered stays out: it can't be answered any more, and its text is locked for me.
 */
export function endedRowsForMe(rows: readonly EndedRow[], myId: string | null): EndedRow[] {
  if (!myId) return [];
  return rows.filter((r) => r.answeredBy.includes(myId));
}

/**
 * The reveal rule in the archive: my partner's answer (and the thread) only when we both
 * answered. RLS already hides their row otherwise; this decides what the screen asks for.
 */
export function endedAnswerState(
  answeredBy: readonly string[],
  myId: string | null,
): { mine: boolean; both: boolean } {
  const mine = !!myId && answeredBy.includes(myId);
  const both = mine && answeredBy.some((id) => id !== myId);
  return { mine, both };
}

/** "Dec 10": the last day the archive can be read, in the phone's own calendar. */
export function untilLabel(until: Date, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(until);
}
