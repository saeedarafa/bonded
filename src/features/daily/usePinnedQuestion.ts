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
 * question is no longer the live one. While the live row is briefly missing, the pinned one shows.
 */
export function usePinnedQuestion<Q extends { id: string; answerCount: number }>(
  live: Q | undefined,
  holds: (id: string) => boolean,
): { question: Q | undefined; stale: boolean } {
  // The opened question as last seen live. Stored only when it changes (another id, or who has
  // answered), so a fresh object for the same row does not re-render.
  const [pinned, setPinned] = useState<Q | undefined>(live);
  if (live && live.id === pinned?.id) {
    if (live.answerCount !== pinned.answerCount) setPinned(live);
    return { question: live, stale: false };
  }
  if (live && (!pinned || !holds(pinned.id))) {
    // Derived state set during render: the next render sees live.id === pinned.id and stops.
    setPinned(live);
    return { question: live, stale: false };
  }
  return { question: pinned, stale: !!pinned && !!live };
}
