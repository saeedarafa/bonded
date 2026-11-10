import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toAppError, type AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import { getPack, getPacks, startPackQuestion, type PackDetail, type PackSummary } from './api';

const HOUR_MS = 60 * 60 * 1000;

/** The library (32). Content changes only with a content load: an hour is fresh enough. */
export function usePacks() {
  return useQuery<PackSummary[], AppError>({
    queryKey: queryKeys.packs.list(),
    queryFn: getPacks,
    staleTime: HOUR_MS,
  });
}

/** One pack and its questions (33). */
export function usePack(packId: string | undefined) {
  return useQuery<PackDetail | null, AppError>({
    queryKey: queryKeys.packs.detail(packId ?? ''),
    queryFn: () => getPack(packId ?? ''),
    enabled: !!packId,
    staleTime: HOUR_MS,
  });
}

/** What the screen does after a failed start. */
export type StartFailure = 'paywall' | 'gone' | 'message';

/**
 * `PREMIUM_REQUIRED` is the server saying no: open the paywall (34), never the question.
 * `QUESTION_UNAVAILABLE`: the pack or question went inactive since we loaded it.
 */
export function startFailure(error: AppError): StartFailure {
  if (error.kind === 'PREMIUM_REQUIRED') return 'paywall';
  if (error.kind === 'QUESTION_UNAVAILABLE') return 'gone';
  return 'message';
}

/**
 * Opens a pack question for the couple (`start_pack_question`). Resolves with the
 * `couple_questions` id. The server checks premium; the app's lock is only a hint.
 */
export function useStartPackQuestion() {
  const qc = useQueryClient();
  return useMutation<string, AppError, string>({
    mutationFn: async (questionId) => {
      try {
        return await startPackQuestion(questionId);
      } catch (e) {
        throw toAppError(e);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.history.all });
    },
    onError: (error) => {
      const failure = startFailure(error);
      // Our premium view was stale (it expired, or the partner's plan ended): ask the server again.
      if (failure === 'paywall')
        void qc.invalidateQueries({ queryKey: queryKeys.entitlements() });
      if (failure === 'gone') void qc.invalidateQueries({ queryKey: queryKeys.packs.all });
    },
  });
}
