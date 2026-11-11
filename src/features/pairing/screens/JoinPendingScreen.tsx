import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { JoinPartnerConfirm } from '@/features/pairing/components/JoinPartnerConfirm';
import { useAcceptInvite, useMyJoinRequest } from '@/features/pairing/hooks';
import {
  joinErrorMessage,
  joinerState,
  usePendingJoin,
  type JoinerState,
} from '@/features/pairing/joinRequest';
import { useTranslation } from '@/i18n';
import { Banner, Button, haptics, Mascot, Text, useTheme } from '@/ui';

const TEST_ID = '12-join-pending';
/** Poll the couple while waiting, in case the approval event is missed. */
const COUPLE_POLL_MS = 5000;

/** Re-renders when `at` passes (the request's expiry), so "waiting" turns into "expired". */
function useNowPast(at: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const when = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(when) || when <= now) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), when - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [at, now]);
  return now;
}

/**
 * BE-26 (D02), the joiner after a typed code, no hand-off board (GAPS.md): "Waiting for Maya to
 * confirm". Watches my own `join_requests` row (Realtime + poll) and my couple: once the approval
 * makes me a member it moves on (J5 -> J6 reminders, 12 -> 13 paired). Declined and expired get
 * their own states with a way back. Route: `/join/pending`.
 */
export default function JoinPendingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status } = useSession();
  const pending = usePendingJoin((s) => s.pending);
  const request = useMyJoinRequest(pending?.requestId);
  const couple = useActiveCouple({
    enabled: status === 'signedIn',
    refetchInterval: COUPLE_POLL_MS,
  });
  const accept = useAcceptInvite(pending?.origin ?? '12');
  const now = useNowPast(pending?.expiresAt);
  const left = useRef(false);
  // MOB-48 (BE-35): "Ask again" answered CONFIRM_ARCHIVE (a solo joiner: every retry needs the D37
  // consent again, and an approval can bounce for a solo space made since the request).
  const [confirming, setConfirming] = useState(false);

  const paired = isCoupleComplete(couple.data);
  const state: JoinerState = pending
    ? joinerState(request.data, pending.expiresAt, paired, now)
    : 'waiting';
  const rowApproved = request.data?.status === 'approved';

  // Approved but my couple hasn't refetched yet: fetch it now instead of waiting for the poll.
  useEffect(() => {
    if (rowApproved && !paired) void queryClient.invalidateQueries();
  }, [rowApproved, paired, queryClient]);

  // The approval landed: I'm a member of their couple. Everything cached is about my old space.
  const origin = pending?.origin;
  useEffect(() => {
    if (!paired || left.current) return;
    left.current = true;
    haptics.success();
    void queryClient.invalidateQueries();
    router.replace(origin === 'J5' ? '/join/reminders' : '/paired');
  }, [paired, origin, queryClient, router]);

  // Screen readers hear the outcome (the screen changes without a tap).
  const name = pending?.inviterName?.trim() || t('pairing.partnerFallback');
  useEffect(() => {
    if (state === 'declined')
      AccessibilityInfo.announceForAccessibility(t('pairing.pending.declinedTitle', { name }));
    if (state === 'expired')
      AccessibilityInfo.announceForAccessibility(t('pairing.pending.expiredTitle'));
    if (state === 'approved')
      AccessibilityInfo.announceForAccessibility(t('pairing.pending.approved'));
  }, [state, name, t]);

  // Leaving (any way) drops the request from memory; on the server it simply lapses.
  useEffect(() => () => usePendingJoin.getState().clear(), []);

  if (status === 'signedOut') return <Redirect href="/join/sign-in" />;
  // Reached without a request in memory (restart, deep link): the index decides where to go.
  if (!pending) return <Redirect href="/" />;

  const solo = !!couple.data && !paired;

  function otherCode() {
    haptics.light();
    left.current = true;
    router.replace(origin === 'J5' ? '/join/code' : '/join');
  }

  function backToMine() {
    left.current = true;
    router.replace(solo ? '/' : '/welcome');
  }

  /** `archiveOwn` (D37 consent) only from the sheet's confirm; a CONFIRM_ARCHIVE reopens it. */
  function askAgain({ archiveOwn = false }: { archiveOwn?: boolean } = {}) {
    if (!pending || accept.isPending) return;
    haptics.light();
    accept.mutate(
      { code: pending.code, token: null, ...(archiveOwn ? { archiveOwn: true } : {}) },
      {
        onSuccess: () => setConfirming(false),
        onError: (e) => {
          haptics.error();
          if (e.kind === 'CONFIRM_ARCHIVE') {
            setConfirming(true);
            return;
          }
          setConfirming(false);
          if (e.kind === 'COUPLE_FULL') {
            left.current = true;
            router.replace('/join/full');
          }
        },
      },
    );
  }

  let mascot = (
    <Mascot
      mood="waiting"
      size={140}
      partnerName={name}
      accessibilityLabel={t('pairing.pending.mascot', { name })}
    />
  );
  let title = t('pairing.pending.title', { name });
  let body: string = t('pairing.pending.body', { name });
  let actions = (
    <>
      <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
        {t('pairing.pending.hint', { name })}
      </Text>
      <Button
        testID={`${TEST_ID}-other-code`}
        variant="ghost"
        label={t('pairing.pending.otherCode')}
        onPress={otherCode}
      />
    </>
  );

  if (state === 'approved') {
    mascot = <Mascot mood="together" size={140} partnerName={name} />;
    title = t('pairing.pending.approved');
    body = '';
    actions = <></>;
  } else if (state === 'declined' || state === 'expired') {
    const declined = state === 'declined';
    mascot = (
      <Mascot
        mood="saving-a-seat"
        size={140}
        partnerName={name}
        accessibilityLabel={
          declined
            ? t('pairing.pending.declinedMascot', { name })
            : t('pairing.pending.expiredMascot')
        }
      />
    );
    title = declined
      ? t('pairing.pending.declinedTitle', { name })
      : t('pairing.pending.expiredTitle');
    body = declined
      ? t('pairing.pending.declinedBody', { name })
      : t('pairing.pending.expiredBody', { name });
    actions = (
      <>
        {accept.error && accept.error.kind !== 'CONFIRM_ARCHIVE' ? (
          <Banner
            tone="error"
            message={joinErrorMessage(accept.error, pending.inviterName)}
            testID={`${TEST_ID}-error`}
          />
        ) : null}
        {declined ? null : (
          <Button
            testID={`${TEST_ID}-ask-again`}
            label={t('pairing.pending.askAgain')}
            loading={accept.isPending}
            onPress={() => askAgain()}
          />
        )}
        <Button
          testID={`${TEST_ID}-other-code`}
          variant={declined ? 'primary' : 'ghost'}
          label={t('pairing.pending.otherCode')}
          onPress={otherCode}
        />
        <Button
          testID={`${TEST_ID}-own`}
          variant="link"
          label={solo ? t('pairing.joinPartner.backToMine') : t('pairing.code.startOwn')}
          onPress={backToMine}
        />
      </>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={TEST_ID}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          padding: space.gutter,
          paddingTop: space.hero,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.lg }} testID={`${TEST_ID}-${state}`}>
          {mascot}
          <Text
            variant="h1"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={{ textAlign: 'center' }}
            testID={`${TEST_ID}-title`}
          >
            {title}
          </Text>
          {body ? (
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {body}
            </Text>
          ) : null}
        </View>
        <View style={{ gap: space.md }}>{actions}</View>
      </ScrollView>
      <JoinPartnerConfirm
        visible={confirming}
        testID={`${TEST_ID}-confirm`}
        partner={pending.inviterName ?? ''}
        loading={accept.isPending}
        onConfirm={() => askAgain({ archiveOwn: true })}
        onCancel={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}
