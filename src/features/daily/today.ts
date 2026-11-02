/**
 * Pure Today logic (MOB-10): which state screens 18, 23, 24 and 28 show, the live countdown to the
 * next question and the day number. No data access here: hooks.ts feeds it.
 */

/** `get_streak()` with nulls made safe (QA-BUG-3: `completed_today` is null without history). */
export type Streak = {
  current: number;
  longest: number;
  lastCompletedOn: string | null;
  completedToday: boolean;
  atRisk: boolean;
  saverAvailable: boolean;
};

export type RawStreak = {
  current: number | null;
  longest: number | null;
  last_completed_on: string | null;
  completed_today: boolean | null;
  at_risk: boolean | null;
  saver_available: boolean | null;
};

export function normalizeStreak(raw: RawStreak | null | undefined): Streak {
  return {
    current: raw?.current ?? 0,
    longest: raw?.longest ?? 0,
    lastCompletedOn: raw?.last_completed_on ?? null,
    completedToday: raw?.completed_today === true,
    atRisk: raw?.at_risk === true,
    saverAvailable: raw?.saver_available === true,
  };
}

/** 18 your turn, 23 waiting on partner, 24 bonded today, 28 napping (missed day). */
export type TodayState = 'yourTurn' | 'waiting' | 'bonded' | 'napping';

export function todayState(input: {
  answeredByMe: boolean;
  answerCount: number;
  partnerJoined: boolean;
  streak: Streak;
}): TodayState {
  const partnerAnswered = input.answerCount - (input.answeredByMe ? 1 : 0) >= 1;
  if (input.answeredByMe && partnerAnswered) return 'bonded';
  if (input.answeredByMe) return 'waiting';
  // A missed day (a streak existed, `current` already dropped to 0) and nobody has started today.
  const missed = input.streak.current === 0 && input.streak.lastCompletedOn !== null;
  if (missed && !partnerAnswered && input.partnerJoined) return 'napping';
  return 'yourTurn';
}

/** Local wall-clock parts in an IANA zone; falls back to the device zone if the runtime can't. */
function zonedParts(now: Date, timeZone: string | null | undefined) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone ?? undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return {
      y: get('year'),
      m: get('month'),
      d: get('day'),
      h: get('hour') % 24,
      min: get('minute'),
      s: get('second'),
    };
  } catch {
    return {
      y: now.getFullYear(),
      m: now.getMonth() + 1,
      d: now.getDate(),
      h: now.getHours(),
      min: now.getMinutes(),
      s: now.getSeconds(),
    };
  }
}

/** Seconds until the next local midnight in the couple's timezone (the next daily question). */
export function secondsUntilNextQuestion(now: Date, timeZone: string | null | undefined): number {
  const { h, min, s } = zonedParts(now, timeZone);
  return Math.max(0, 86400 - (h * 3600 + min * 60 + s));
}

/** 51729 → "14:22:09". */
export function formatCountdown(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

/**
 * When "Day N together" starts: `couples.paired_at` (server-set when the partner joined, BE-04c),
 * or `created_at` while solo or for couples paired before that column existed.
 */
export function togetherSince(couple: { paired_at: string | null; created_at: string }): string {
  return couple.paired_at ?? couple.created_at;
}

/** "Day 12 together": calendar days since `togetherSince`, counting today as day N. */
export function dayNumber(
  createdAt: string,
  now: Date,
  timeZone: string | null | undefined,
): number {
  const a = zonedParts(new Date(createdAt), timeZone);
  const b = zonedParts(now, timeZone);
  const days = (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000;
  return Math.max(1, Math.round(days) + 1);
}
