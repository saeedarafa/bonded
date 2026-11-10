import type { IconName, PackTone } from '@/ui';

import type { PackDetail, PackQuestion } from './api';

/** Board 32's icon and tile colour per pack (`question_packs.icon`); unknown slugs get the layers. */
const VISUALS: Record<string, { icon: IconName; tone: PackTone }> = {
  gratitude: { icon: 'heart', tone: 'you' },
  'deep-talks': { icon: 'sparkle', tone: 'you' },
  'laugh-together': { icon: 'smile', tone: 'premium' },
  'future-us': { icon: 'compass', tone: 'partner' },
  // The board's lavender has no token: sky until one exists (GAPS).
  'long-distance': { icon: 'send', tone: 'partner' },
  spicy: { icon: 'today', tone: 'blush' },
  'money-home': { icon: 'home', tone: 'success' },
};

export function packVisual(icon: string | null): { icon: IconName; tone: PackTone } {
  return (icon && VISUALS[icon]) || { icon: 'packs', tone: 'you' };
}

/**
 * What 33 shows (D51: packs come with Premium; no free question).
 * - `open`: a Premium couple (mine or my partner's) sees and can start every question.
 * - `locked`: a free couple sees one question as a read-only sample ("A question from this pack"),
 *   the questions it already started (under D43 or while Premium: they stay openable), and the
 *   rest as locked rows **without their text** (so it never reaches the screen or screen reader).
 * The pack's `is_premium` flag no longer opens anything (BE-46). `premium` must come from the
 * server (`usePremium()`); while it is unknown, pass false. Display only: the server decides.
 */
export type PackPreview =
  | { mode: 'open'; questions: PackQuestion[] }
  | {
      mode: 'locked';
      sample: PackQuestion | null;
      started: { question: PackQuestion; coupleQuestionId: string }[];
      locked: { id: string; position: number }[];
    };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function packPreview(
  pack: PackDetail,
  premium: boolean,
  /** question id -> the couple's `couple_questions` id, for questions already started. */
  started: Readonly<Record<string, string>> = {},
): PackPreview {
  if (premium) return { mode: 'open', questions: pack.questions };
  const startedRows = pack.questions.flatMap((q) => {
    const coupleQuestionId = has(started, q.id) ? started[q.id] : undefined;
    return coupleQuestionId ? [{ question: q, coupleQuestionId }] : [];
  });
  const rest = pack.questions.filter((q) => !has(started, q.id));
  const [sample, ...others] = rest;
  return {
    mode: 'locked',
    sample: sample ?? null,
    started: startedRows,
    locked: others.map((q) => ({ id: q.id, position: q.position })),
  };
}
