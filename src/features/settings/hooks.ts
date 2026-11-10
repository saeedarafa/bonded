import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { updateMyProfile } from '@/features/profile/api';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/database';

import {
  deleteAccount,
  getLatestEndedCouple,
  getNotificationPrefs,
  getProfileName,
  isAccountGone,
  saveNotificationPrefs,
  updateCoupleSettings,
  type EndedCouple,
  type NotificationPrefs,
} from './api';
import { wipeLocalAccount } from './localData';
import { formerPartnerId, partnerLeftCouple, useEndedSeen } from './partnerLeft';

/** My notification preferences (41). Null only if the sign-up row is missing (the upsert fixes it). */
export function useNotificationPrefs() {
  const { userId } = useSession();
  return useQuery<NotificationPrefs | null, AppError>({
    queryKey: queryKeys.notificationPrefs(),
    queryFn: getNotificationPrefs,
    enabled: userId !== null,
  });
}

/**
 * Save some preferences. Optimistic (a switch flips at once); a failure puts the old values back
 * and the screen says so. Never queued offline: a switch that silently waits would lie.
 */
export function useSaveNotificationPrefs() {
  const qc = useQueryClient();
  const { userId } = useSession();
  return useMutation<
    void,
    AppError,
    Partial<NotificationPrefs>,
    { previous: NotificationPrefs | null | undefined }
  >({
    mutationFn: (patch) => saveNotificationPrefs(userId ?? '', patch),
    networkMode: 'always',
    retry: false,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: queryKeys.notificationPrefs() });
      const previous = qc.getQueryData<NotificationPrefs | null>(queryKeys.notificationPrefs());
      if (previous) qc.setQueryData(queryKeys.notificationPrefs(), { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(queryKeys.notificationPrefs(), context.previous);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.notificationPrefs() }),
  });
}

type Stage = Database['public']['Enums']['couple_stage'];

/** Stage or topics on 42. */
export function useUpdateCouple(coupleId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<void, AppError, { stage?: Stage; goals?: string[] }>({
    mutationFn: (fields) => updateCoupleSettings(coupleId ?? '', fields),
    networkMode: 'always',
    retry: false,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.couple.active() }),
  });
}

/** "Our names" on 42 edits my own name only; my partner's is theirs. */
export function useUpdateMyName() {
  const qc = useQueryClient();
  const { userId } = useSession();
  return useMutation<void, AppError, string>({
    mutationFn: (displayName) => updateMyProfile(userId ?? '', { displayName }),
    networkMode: 'always',
    retry: false,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.profiles.all }),
  });
}

/** How 43 ended: the server deleted the account, or only this phone's session ended. */
export type DeleteOutcome = 'deleted' | 'signedOut';

/**
 * 43: `delete-account`, then everything local goes (session, caches, MMKV, RevenueCat identity).
 * The auth gate then shows onboarding. Never retried on its own, never queued offline.
 *
 * A 401 (`SIGNED_OUT`) does not prove the account is gone: the gateway also rejects an expired
 * token, and the function answers 401 when Auth is down or the session was revoked elsewhere. So
 * Auth is asked once (`isAccountGone`): only its "user not found" counts as `deleted` (an earlier
 * call deleted it but its answer was lost). Anything else still wipes this phone (the session is
 * dead or unusable) but ends as `signedOut`, and the person signs in again to finish.
 * NETWORK and UNKNOWN (incl. 503 AUTH_UNAVAILABLE, BE-39) keep the session so "Delete forever"
 * can retry.
 */
export function useDeleteAccount() {
  return useMutation<DeleteOutcome, AppError, void>({
    mutationFn: async () => {
      let outcome: DeleteOutcome = 'deleted';
      try {
        await deleteAccount();
      } catch (error) {
        if (!(error instanceof AppError) || error.kind !== 'SIGNED_OUT') throw error;
        // Ask before the wipe: it signs out locally, and getUser needs the session.
        if (!(await isAccountGone())) outcome = 'signedOut';
      }
      await wipeLocalAccount();
      return outcome;
    },
    networkMode: 'always',
    retry: false,
  });
}

/** My latest ended couple that had a partner (D08/D09), read only while I have no active couple. */
export function useEndedCouple({ enabled }: { enabled: boolean }) {
  return useQuery<EndedCouple | null, AppError>({
    queryKey: queryKeys.couple.ended(),
    queryFn: getLatestEndedCouple,
    enabled,
  });
}

/**
 * 58: an ended couple I have not been told about on this device. `undefined` while unknown
 * (the front door waits), null when there is nothing to tell.
 */
export function usePartnerLeft({ enabled }: { enabled: boolean }): {
  couple: EndedCouple | null | undefined;
  failed: boolean;
} {
  const { userId } = useSession();
  const ended = useEndedCouple({ enabled });
  const seen = useEndedSeen((s) => s.seen);
  if (!enabled) return { couple: null, failed: false };
  // Never block the way in on this extra read: on an error, carry on without 58.
  if (ended.isError) return { couple: null, failed: true };
  if (ended.data === undefined) return { couple: undefined, failed: false };
  const left = partnerLeftCouple(ended.data, seen, userId);
  // A cached "nothing" may be old news: wait for the fresh read (offline it pauses, not fetches).
  if (!left && ended.fetchStatus === 'fetching') return { couple: undefined, failed: false };
  return { couple: left, failed: false };
}

/**
 * The query for the former partner's name (shared by 58's title and the History PDF, MOB-27b, so
 * the export can await the same cached read). Null when their profile is gone (D09) or unreadable.
 */
export function formerPartnerNameQuery(partnerId: string | null) {
  return queryOptions<string | null, AppError>({
    queryKey: [...queryKeys.profiles.all, 'former', partnerId ?? ''],
    queryFn: () => getProfileName(partnerId ?? ''),
    enabled: partnerId !== null,
    retry: false,
  });
}

/** The former partner's name for 58, if their profile is still readable; else null. */
export function useFormerPartnerName(couple: EndedCouple | null | undefined) {
  const { userId } = useSession();
  return useQuery(formerPartnerNameQuery(formerPartnerId(couple ?? null, userId)));
}

/** My first name and my partner's for the settings screens (profile first, then the couple's). */
export function usePairNames() {
  const { t } = useTranslation();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  const me = profiles.me?.display_name?.trim() || t('today.you');
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  return { couple, profiles, me, partner };
}
