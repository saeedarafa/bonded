import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { getCoupleProfiles, type Profile } from '@/features/profile/api';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

/** My profile and my partner's, with `me` and `partner` picked out by the session user id. */
export function useCoupleProfiles() {
  const { userId } = useSession();
  const query = useQuery<Profile[], AppError>({
    queryKey: queryKeys.profiles.couple(),
    queryFn: getCoupleProfiles,
    enabled: userId !== null,
  });
  const me = query.data?.find((p) => p.id === userId) ?? null;
  const partner = query.data?.find((p) => p.id !== userId) ?? null;
  return { ...query, me, partner };
}
