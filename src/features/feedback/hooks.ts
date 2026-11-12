import { useMutation } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { FEEDBACK_TAG_IDS, track } from '@/lib/analytics';
import { AppError, messageFor } from '@/lib/errors';

import { sendFeedback, type FeedbackInput } from './api';

/**
 * Send a feedback or check-in row. Never queued offline and never retried silently: the person
 * sees the failure and can send again. Nothing to invalidate (no client reads the table).
 */
export function useSendFeedback() {
  const { userId } = useSession();
  return useMutation<void, AppError, Omit<FeedbackInput, 'userId'>>({
    mutationFn: async (input) => {
      if (!userId) throw new AppError('SIGNED_OUT', messageFor('SIGNED_OUT'));
      await sendFeedback({ ...input, userId });
    },
    networkMode: 'always',
    retry: false,
    onSuccess: (_data, input) => trackFeedbackSent(input),
  });
}

const TAG_IDS: readonly string[] = FEEDBACK_TAG_IDS;

/**
 * Analytics (MOB-24d, ANALYTICS §3.7), once the row is in: never the text. `feedback_sent.rating`
 * is the 27 tag id when exactly one tag was picked (several or none: no rating); the check-in
 * sends its score (1 to 5).
 */
export function trackFeedbackSent(input: Pick<FeedbackInput, 'kind' | 'score' | 'tags'>): void {
  if (input.kind === 'check_in') {
    if (input.score !== null) track('check_in_answered', { score: input.score });
    return;
  }
  const [only] = input.tags.length === 1 ? input.tags : [];
  if (only !== undefined && TAG_IDS.includes(only)) {
    track('feedback_sent', { rating: only as (typeof FEEDBACK_TAG_IDS)[number] });
  } else {
    track('feedback_sent', {});
  }
}
