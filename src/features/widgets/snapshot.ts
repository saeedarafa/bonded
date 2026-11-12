import type { ActiveCouple } from '@/features/couple/api';
import { isCoupleComplete } from '@/features/couple/hooks';
import type { TodayQuestion } from '@/features/daily/api';
import {
  dayNumber,
  secondsUntilNextQuestion,
  todayState,
  togetherSince,
  type Streak,
} from '@/features/daily/today';
import { t } from '@/i18n';

/**
 * Home and lock-screen widgets (MOB-30, D26; 38b MOB-57, D47). The app writes this snapshot to
 * storage the widgets can read (iOS App Group, Android shared preferences) whenever Today changes.
 *
 * Reveal rule (FUN-04): the widgets live on the home and lock screen, so the snapshot holds only
 * booleans, the day's deadline, the streak and day counts, the partner's first name and fixed copy.
 * Never answer or message text, and not the question either. The builder copies whitelisted
 * fields one by one; it never spreads an input object.
 */

/** Bump when the shape changes: the native widgets ignore a version they don't know. */
export const WIDGET_SNAPSHOT_VERSION = 1;

/**
 * none: signed out or no couple yet · solo: partner hasn't joined · yourTurn: nobody answered ·
 * partnerAnswered: they answered, I haven't (38b right) · waiting: I answered, they haven't ·
 * bonded: both answered · napping: a missed day (28).
 */
export type WidgetState =
  'none' | 'solo' | 'yourTurn' | 'partnerAnswered' | 'waiting' | 'bonded' | 'napping';

/** Still Bao and Bun pose per state (widgets can't loop, D47): `design-handoff/assets/mascot`. */
export type WidgetMood = 'snuggled' | 'saving-a-seat' | 'waiting' | 'celebrating' | 'napping';

export type WidgetText = {
  /** "Day 12" (38 small). */
  day: string;
  /** One line for the small 38 widget and the lock screen ("Sam answered · your turn"). */
  line: string;
  /** Medium 38 title; 38b "Sam answered". */
  title: string;
  /** Medium 38 second line (the streak when there is one); 38b "Reply to see theirs." */
  sub: string;
  /** "12-day streak", empty without a streak. */
  streak: string;
  /** Label in front of the live countdown to `dayEndsAt`. */
  timer: string;
  /** 38b Countdown: "Your turn", "to keep your streak", "Answer now". */
  turn: string;
  keep: string;
  cta: string;
  /** Once `dayEndsAt` has passed and the app hasn't written since: a new question is waiting. */
  newDayTitle: string;
  newDayLine: string;
};

export type WidgetSnapshot = {
  v: number;
  state: WidgetState;
  mood: WidgetMood;
  answeredByMe: boolean;
  partnerAnswered: boolean;
  partnerJoined: boolean;
  /** Current streak (days), 0 without one. */
  streak: number;
  /** "Day N together", null without a couple. */
  day: number | null;
  /** Partner's first name only, null when unknown (the copy then says "your partner"). */
  partnerName: string | null;
  /** Epoch ms: the couple-local midnight that ends the day this snapshot describes. */
  dayEndsAt: number | null;
  /** Epoch ms when the app wrote it. */
  updatedAt: number;
  text: WidgetText;
};

export type WidgetSources = {
  userId: string | null;
  couple: ActiveCouple | null | undefined;
  question: TodayQuestion | undefined;
  /** When the cached Today question was fetched (`dataUpdatedAt`): the day it belongs to. */
  questionFetchedAt: number;
  streak: Streak | undefined;
  /** The partner's display name (profile, else the name given at onboarding). */
  partnerDisplayName: string | null | undefined;
  now: Date;
};

const MAX_NAME_LENGTH = 20;

/** "  Sam Rivers " -> "Sam". At most 20 characters (code points), so a long name can't fill a widget. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first) return null;
  return Array.from(first).slice(0, MAX_NAME_LENGTH).join('');
}

const MOODS: Record<WidgetState, WidgetMood> = {
  none: 'snuggled',
  solo: 'saving-a-seat',
  yourTurn: 'waiting',
  partnerAnswered: 'waiting',
  waiting: 'waiting',
  bonded: 'celebrating',
  napping: 'napping',
};

function texts(state: WidgetState, partner: string, streak: number, day: number | null) {
  const streakLine = streak > 0 ? t('widget.streak', { n: streak }) : '';
  return {
    day: day !== null ? t('widget.day', { n: day }) : '',
    line: t(`widget.line.${state}`, { partner }),
    title: t(`widget.title.${state}`, { partner }),
    sub:
      streakLine && state !== 'partnerAnswered'
        ? streakLine
        : t(`widget.sub.${state}`, { partner }),
    streak: streakLine,
    timer: state === 'bonded' ? t('widget.nextIn') : t('widget.leftToday'),
    turn: t('widget.turn'),
    keep: streak > 0 ? t('widget.keepStreak') : t('widget.startStreak'),
    cta: t('widget.cta'),
    newDayTitle: t('widget.newDayTitle'),
    newDayLine: t('widget.newDayLine'),
  } satisfies WidgetText;
}

function snapshot(
  state: WidgetState,
  fields: Omit<WidgetSnapshot, 'v' | 'state' | 'mood' | 'text'>,
): WidgetSnapshot {
  const partner = fields.partnerName ?? t('pairing.partnerFallback');
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    state,
    mood: MOODS[state],
    answeredByMe: fields.answeredByMe,
    partnerAnswered: fields.partnerAnswered,
    partnerJoined: fields.partnerJoined,
    streak: fields.streak,
    day: fields.day,
    partnerName: fields.partnerName,
    dayEndsAt: fields.dayEndsAt,
    updatedAt: fields.updatedAt,
    text: texts(state, partner, fields.streak, fields.day),
  };
}

/** Signed out, or signed in before a couple exists: nothing personal on the home screen. */
export function emptyWidgetSnapshot(now: Date): WidgetSnapshot {
  return snapshot('none', {
    answeredByMe: false,
    partnerAnswered: false,
    partnerJoined: false,
    streak: 0,
    day: null,
    partnerName: null,
    dayEndsAt: null,
    updatedAt: now.getTime(),
  });
}

/**
 * The widget snapshot for what the app knows now, or null while Today hasn't loaded (the widgets
 * keep the last snapshot until then).
 */
export function buildWidgetSnapshot(src: WidgetSources): WidgetSnapshot | null {
  if (!src.userId || src.couple === null) return emptyWidgetSnapshot(src.now);
  if (!src.couple || !src.question || !src.streak) return null;

  const couple = src.couple;
  const timeZone = couple.timezone;
  const answeredByMe = src.question.answers.some((a) => a.userId === src.userId);
  // The count includes a locked partner answer; RLS hides its row (and its text) until I answer.
  const partnerAnswered = src.question.answerCount - (answeredByMe ? 1 : 0) >= 1;
  const partnerJoined = isCoupleComplete(couple);
  const streak = Math.max(0, Math.floor(src.streak.current));

  let state: WidgetState;
  if (!partnerJoined) state = 'solo';
  else {
    const today = todayState({
      answeredByMe,
      answerCount: src.question.answerCount,
      partnerJoined,
      streak: src.streak,
    });
    state = today === 'yourTurn' && partnerAnswered ? 'partnerAnswered' : today;
  }

  // The day the cached question belongs to ends at the couple's next local midnight after it was
  // fetched (a question restored from the persisted cache may be yesterday's).
  const fetchedAt = src.questionFetchedAt > 0 ? src.questionFetchedAt : src.now.getTime();
  // Whole seconds, so every fetch on the same day gives the same midnight (no needless reload).
  const fetchedSecond = Math.floor(fetchedAt / 1000) * 1000;
  const dayEndsAt =
    fetchedSecond + secondsUntilNextQuestion(new Date(fetchedSecond), timeZone) * 1000;

  return snapshot(state, {
    answeredByMe,
    partnerAnswered,
    partnerJoined,
    streak,
    day: dayNumber(togetherSince(couple), src.now, timeZone),
    partnerName: firstName(src.partnerDisplayName),
    dayEndsAt,
    updatedAt: src.now.getTime(),
  });
}

/** Equal for the widgets (ignores `updatedAt`): no write, no widget reload. */
export function sameForWidgets(a: WidgetSnapshot | null, b: WidgetSnapshot | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}
