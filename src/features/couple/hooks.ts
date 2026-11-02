import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getActiveCouple, unpair, type ActiveCouple } from '@/features/couple/api';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

/** My active couple, or null before onboarding has created it (`create_couple`, BE-03). */
export function useActiveCouple({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<ActiveCouple | null, AppError>({
    queryKey: queryKeys.couple.active(),
    queryFn: getActiveCouple,
    enabled,
  });
}

/** Leave the couple. Idempotent: a retry after success is success. */
export function useUnpair() {
  const queryClient = useQueryClient();
  return useMutation<void, AppError>({
    mutationFn: unpair,
    // Everything about the old couple is stale (and ends up read-only, D08).
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
