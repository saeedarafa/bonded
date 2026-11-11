import { useState } from 'react';

/**
 * #258 (D56): 19 stays bound to the question the person opened. Today's row can change under an
 * open 19 (the couple's day ended: Realtime, the partner opening the app after midnight, or a
 * foreground refetch brings the next day's row). While the opened question still holds work (a
 * typed draft, a voice take, a lock-in in flight or failed, a queued answer), 19 keeps showing it,
 * so the lock-in goes to that id and the server answers `DAY_ENDED` (or accepts it in its grace).
 * With nothing to lose, 19 moves on to the new question.
 *
 * Updates of the same row (answer counts) always come through. `stale` is true while the pinned
 * question is no longer the live one.
 */
export function usePinnedQuestion<Q extends { id: string }>(
  live: Q | undefined,
  holds: (id: string) => boolean,
): { question: Q | undefined; stale: boolean } {
  const [pinned, setPinned] = useState<Q | undefined>(live);
  const follow =
    !!live && (!pinned || (live.id === pinned.id ? live !== pinned : !holds(pinned.id)));
  // Derived state, set during render (converges in one pass: the next render has live === pinned).
  if (follow) setPinned(live);
  const question = follow ? live : (pinned ?? live);
  return { question, stale: !!question && !!live && question.id !== live.id };
}
