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

/** What 33 shows. `open` is display only: the server decides when a question is started. */
export type PreviewRow =
  | { kind: 'open'; question: PackQuestion }
  | { kind: 'locked'; id: string; position: number };

export type PackPreview = {
  /** The pack's first question: free for every couple (SCOPE 33). Null for an empty pack. */
  free: PackQuestion | null;
  rows: PreviewRow[];
  /** Locked rows exist: show "Unlock every pack". */
  locked: boolean;
};

/**
 * Splits a pack for 33. Without premium, only the first question's text is shown; the others are
 * locked rows **without their text** (so it never reaches the screen or the screen reader).
 * `premium` must come from the server (`usePremium()`); while it is unknown, pass false.
 */
export function packPreview(pack: PackDetail, premium: boolean): PackPreview {
  const [first, ...rest] = pack.questions;
  const open = premium || !pack.isPremium;
  const rows: PreviewRow[] = rest.map((q) =>
    open ? { kind: 'open', question: q } : { kind: 'locked', id: q.id, position: q.position },
  );
  return { free: first ?? null, rows, locked: !open && rest.length > 0 };
}
