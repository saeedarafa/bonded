import { useMutation } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
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
  });
}
