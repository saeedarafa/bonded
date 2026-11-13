import { Redirect, useRouter } from 'expo-router';
import { type ComponentRef, useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { Keyboard, View } from 'react-native';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { JoinPartnerConfirm } from '@/features/pairing/components/JoinPartnerConfirm';
import { useJoinPartner, useSoloStatus } from '@/features/pairing/hooks';
import { joinErrorMessage } from '@/features/pairing/joinRequest';
import { NAME_MAX } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { messageFor } from '@/lib/errors';
import { AvatarPair, Banner, Button, haptics, KeepInView, Text, TextField, useTheme } from '@/ui';

const STEP = 2;
const STEPS = 3;

/** J5 Your name (2 of 3). Saving it also joins the inviter's couple; stage and dates come with it. */
export default function JoinNameRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { space } = useTheme();
  const { status, userId } = useSession();
  const { code, token, inviterName } = usePendingInvite();
  const join = useJoinPartner();
  const [name, setName] = useState('');
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // BE-35: the server said CONFIRM_ARCHIVE (we thought "not solo"): the sheet asks after all.
  const [serverAsked, setServerAsked] = useState(false);
  const nameInput = useRef<ComponentRef<typeof TextInput>>(null);
  // D37: someone who started their own space joins a partner: ask first, their space is archived.
  // Until the couple query answers (or after it fails) we don't know, so nobody joins (#112).
  const soloStatus = useSoloStatus({ enabled: status === 'signedIn' });
  const solo = soloStatus.status === 'solo' || serverAsked;
  const known = solo || soloStatus.status === 'notSolo';

  // Joining spends the invite and clears it from memory before the caches refresh (#26): once a
  // join has started, only its own callbacks move on (J6 on success, the code screen on a dead code).
  if (!code && join.isIdle) return <Redirect href="/join/code" />;
  if (status === 'signedOut') return <Redirect href="/join/sign-in" />;

  const partner = inviterName?.trim() || '';
  const me = name.trim();

  /** The field's Return and the J5 button. A solo joiner only opens the D37 sheet here (#112). */
  function submit() {
    // While the sheet is open only its own confirm may join: a stray Return (hardware keyboard)
    // or a tap on the button behind it does nothing.
    if (confirming) return;
    if (!me) {
      setMissing(true);
      haptics.error();
      return;
    }
    if (!userId || !code || join.isPending || !known) return;
    if (solo) {
      haptics.light();
      nameInput.current?.blur();
      Keyboard.dismiss();
      setConfirming(true);
      return;
    }
    startJoin();
  }

  /**
   * D37 sheet "Join": the only way a solo joiner reaches `accept_invite`, and the only place the
   * archive consent (`p_archive_own: true`, BE-35) is sent.
   */
  function confirmJoin() {
    if (!confirming || !solo || !me || !userId || !code || join.isPending) return;
    startJoin({ archiveOwn: true });
  }

  function startJoin({ archiveOwn = false }: { archiveOwn?: boolean } = {}) {
    if (!userId || !code) return;
    join.mutate(
      { userId, displayName: me, code, token, ...(archiveOwn ? { archiveOwn: true } : {}) },
      {
        // A typed code waits for the inviter's yes (BE-26); a link token joins at once.
        onSuccess: (result) => {
          setConfirming(false);
          router.replace(result.kind === 'pending' ? '/join/pending' : '/join/reminders');
        },
        onError: (e) => {
          haptics.error();
          // BE-35: the server wants the D37 consent (a solo space we didn't know about, or a
          // stale one). Reopen the sheet; only its confirm sends the flag, never a retry here.
          if (e.kind === 'CONFIRM_ARCHIVE') {
            setServerAsked(true);
            setConfirming(true);
            void soloStatus.retry();
            return;
          }
          setConfirming(false);
          if (e.kind === 'COUPLE_FULL') router.replace('/join/full');
          // The code died between the preview and now: start over from the code screen.
          else if (e.kind === 'INVALID_CODE' || e.kind === 'INVITE_EXPIRED') {
            usePendingInvite.getState().clear();
            router.replace('/join/code');
          }
        },
      },
    );
  }

  return (
    <>
      <OnboardingFrame
        screenId="J5"
        step={{ n: STEP, total: STEPS }}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/join/code'))}
        footer={
          <>
            {soloStatus.error ? (
              <Banner
                tone="error"
                message={messageFor(soloStatus.error.kind)}
                testID="J5-couple-error"
              />
            ) : null}
            {join.error && join.error.kind !== 'CONFIRM_ARCHIVE' ? (
              <Banner
                tone="error"
                message={joinErrorMessage(join.error, partner)}
                testID="J5-error"
              />
            ) : null}
            {soloStatus.status === 'error' ? (
              <Button
                testID="J5-couple-retry"
                label={t('ui.retry')}
                loading={soloStatus.fetching}
                onPress={soloStatus.retry}
              />
            ) : (
              <Button
                testID="J5-join"
                label={
                  partner ? t('pairing.name.join', { name: partner }) : t('pairing.name.joinNoName')
                }
                loading={join.isPending || soloStatus.status === 'loading'}
                onPress={submit}
              />
            )}
          </>
        }
      >
        <View style={{ gap: space.lg }}>
          <View style={{ alignItems: 'center', gap: space.md }}>
            {me && partner ? (
              <AvatarPair testID="J5-pair" meName={me} partnerName={partner} size="lg" />
            ) : null}
            <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {partner ? t('pairing.name.title', { name: partner }) : t('pairing.name.titleNoName')}
            </Text>
          </View>
          <KeepInView style={{ gap: space.lg }}>
            <TextField
              testID="J5-name"
              inputRef={nameInput}
              label={t('pairing.name.field')}
              showLabel
              value={name}
              onChangeText={setName}
              maxLength={NAME_MAX}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="done"
              onSubmitEditing={submit}
              error={missing && !me ? t('pairing.name.missing') : null}
            />
            <Text variant="caption" tone="text2">
              {partner
                ? t('pairing.name.inherited', { name: partner })
                : t('pairing.name.inheritedNoName')}
            </Text>
          </KeepInView>
        </View>
      </OnboardingFrame>
      <JoinPartnerConfirm
        visible={confirming}
        testID="J5-confirm"
        partner={partner}
        loading={join.isPending}
        onConfirm={confirmJoin}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
