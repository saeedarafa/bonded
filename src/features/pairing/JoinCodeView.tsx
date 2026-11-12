import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { keyboardBehavior } from '@/features/daily/components/DailyFrame';
import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { trackCodeEntered } from '@/features/pairing/analytics';
import { JoinPartnerConfirm } from '@/features/pairing/components/JoinPartnerConfirm';
import { track } from '@/lib/analytics';
import { displayCode } from '@/features/pairing/invite';
import { useAcceptInvite, useInvitePreview, useSoloStatus } from '@/features/pairing/hooks';
import { joinErrorMessage } from '@/features/pairing/joinRequest';
import type { InvitePreview } from '@/features/pairing/api';
import { useTranslation } from '@/i18n';
import { messageFor, type AppError } from '@/lib/errors';
import {
  Avatar,
  Banner,
  Button,
  CodeInput,
  haptics,
  Mascot,
  Text,
  TopBar,
  useTheme,
  type CodeInputHandle,
} from '@/ui';

type Props = {
  /**
   * `public`: before sign-in, previews the inviter (J3, J9, 56). `account`: signed in, joins at
   * once (12): with a link token it pairs, a typed code waits for the inviter (`/join/pending`).
   */
  mode: 'public' | 'account';
  /** The four digits to start with (from the link or the route). */
  initialCode: string;
  /**
   * J2 already asked about this code (MOB-40): show that answer (J9, 56) instead of asking again,
   * so one link counts once against the failed-attempt limiter.
   */
  initialError?: AppError | null;
  onBack: () => void;
};

/**
 * One code-entry screen for J3 (code filled from the link), J9 (wrong code), 56 (expired) and 12
 * (signed-in "Join with code"). Every submit counts against the 5-failures-per-15-minutes limiter
 * (BE-04), so it only runs when the 4th digit lands, never on its own.
 */
export function JoinCodeView({ mode, initialCode, initialError = null, onBack }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status } = useSession();
  const pending = usePendingInvite();
  const preview = useInvitePreview();
  const accept = useAcceptInvite();
  const [digits, setDigits] = useState(initialCode);
  const [found, setFound] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<AppError | null>(initialCode ? initialError : null);
  const submitted = useRef(initialCode && initialError ? initialCode : '');
  // D37 (12 only, it joins at once): a code waiting for "yes, archive my own space".
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const soloStatus = useSoloStatus();
  const solo = soloStatus.status === 'solo';
  const known = solo || soloStatus.status === 'notSolo';
  // 12: a complete code waiting for the couple status (#112): never "not solo" before we know.
  const [waitingCode, setWaitingCode] = useState<string | null>(null);
  const waiting = useRef<string | null>(null);

  function wait(code: string | null) {
    waiting.current = code;
    setWaitingCode(code);
  }

  async function waitForCouple(code: string) {
    wait(code);
    const next = await soloStatus.resolve();
    // Typed something else meanwhile, or still no answer (the banner offers a retry): no join.
    if (waiting.current !== code || (next !== 'solo' && next !== 'notSolo')) return;
    wait(null);
    submitted.current = code;
    if (next === 'solo') setConfirmCode(code);
    else join(code);
  }
  const codeInput = useRef<CodeInputHandle>(null);

  // A token only vouches for the code it came with.
  const tokenFor = (code: string) => (pending.code === code ? pending.token : null);

  function fail(e: AppError) {
    haptics.error();
    if (e.kind === 'COUPLE_FULL') {
      router.replace('/join/full');
      return;
    }
    setError(e);
  }

  function submit(code: string) {
    // D37 sheet open: only its confirm joins (#112); a re-typed code doesn't swap what it confirms.
    if (confirmCode !== null) return;
    if (mode === 'account' && !known) {
      Keyboard.dismiss();
      void waitForCouple(code);
      return;
    }
    if (submitted.current === code) return;
    submitted.current = code;
    // The code is complete: put the number pad away so Continue / Try again are not under it (#27).
    Keyboard.dismiss();
    setError(null);
    setFound(null);
    const token = tokenFor(code);
    if (mode === 'public') {
      preview.mutate(
        { code, token },
        {
          onSuccess: (result) => {
            // Analytics (MOB-24d, §3.4): a typed code checked out; J3 now welcomes the joiner.
            if (!token) trackCodeEntered(null);
            track('join_started', { via: token ? 'link' : 'code' });
            haptics.success();
            usePendingInvite.getState().set({ code, token, inviterName: result.inviterName });
            setFound(result);
          },
          onError: (e) => {
            if (!token) trackCodeEntered(e);
            fail(e);
          },
        },
      );
    } else if (solo) {
      setConfirmCode(code);
    } else {
      join(code);
    }
  }

  /**
   * `archiveOwn` is the D37 consent (BE-35): only the sheet's confirm passes it. If the server
   * answers CONFIRM_ARCHIVE anyway, the sheet opens again; nothing retries with the flag.
   */
  function join(code: string, { archiveOwn = false }: { archiveOwn?: boolean } = {}) {
    const token = tokenFor(code);
    accept.mutate(
      { code, token, ...(archiveOwn ? { archiveOwn: true } : {}) },
      {
        // A typed code waits for the inviter's yes (BE-26); a link token joins at once.
        onSuccess: (result) => {
          if (!token) trackCodeEntered(null);
          setConfirmCode(null);
          router.replace(result.kind === 'pending' ? '/join/pending' : '/paired');
        },
        onError: (e) => {
          if (!token) trackCodeEntered(e);
          if (e.kind === 'CONFIRM_ARCHIVE') {
            haptics.error();
            setConfirmCode(code);
            void soloStatus.retry();
            return;
          }
          setConfirmCode(null);
          fail(e);
        },
      },
    );
  }

  function cancelJoin() {
    setConfirmCode(null);
    submitted.current = '';
  }

  function change(next: string) {
    setDigits(next);
    if (next.length < 4) {
      wait(null);
      submitted.current = '';
      setError(null);
      setFound(null);
    }
  }

  function reset() {
    wait(null);
    submitted.current = '';
    setDigits('');
    setError(null);
    setFound(null);
    // Back to typing: the number pad returns (it was put away when the code was complete).
    codeInput.current?.focus();
  }

  function startOwn() {
    usePendingInvite.getState().clear();
    // D37: signed in, they already have their own space: go back to it, not to onboarding.
    router.replace(status === 'signedIn' ? '/' : '/welcome');
  }

  const coupleFailed = mode === 'account' && soloStatus.status === 'error';
  const checking = preview.isPending || accept.isPending || (!!waitingCode && !coupleFailed);
  const expired = error?.kind === 'INVITE_EXPIRED';
  const wrong = !!error && !expired;
  const name = found?.inviterName.trim() || t('pairing.partnerFallback');

  const title = expired
    ? t('pairing.code.expiredTitle')
    : found
      ? t('pairing.code.titleFound', { name })
      : t('pairing.code.title');
  // 56: the name is only known when this code was previewed before (the error has no name).
  const expiredName =
    (pending.code === digits ? pending.inviterName?.trim() : '') || t('pairing.partnerFallback');
  const body = expired
    ? t('pairing.code.expiredBody', { name: expiredName })
    : found
      ? pending.token
        ? t('pairing.code.bodyFound', { name })
        : null
      : t('pairing.code.body');

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID={`${mode === 'public' ? 'J3' : '12'}-screen`}
    >
      <TopBar testID="join-code-top" onBack={onBack} />
      {/* While typing, the content shrinks above the number pad and scrolls (#27). */}
      <KeyboardAvoidingView
        testID="join-code-keyboard"
        style={{ flex: 1 }}
        behavior={keyboardBehavior(Platform.OS).behavior}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            gap: space.xl,
            paddingHorizontal: space.gutter,
            paddingVertical: space.xl,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View
            style={{ alignItems: 'center', gap: space.md }}
            {...(expired ? { testID: '56-expired' } : {})}
          >
            <Mascot mood={found ? 'together' : 'saving-a-seat'} size={120} />
            <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {title}
            </Text>
            {body ? (
              <Text tone="text2" style={{ textAlign: 'center' }}>
                {body}
              </Text>
            ) : null}
          </View>

          {expired ? (
            // Board 56 also says when it expired; the error carries no date, so the code alone.
            <Text
              testID="56-code"
              variant="label"
              tone="text2"
              style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }}
            >
              {t('pairing.code.expiredCode', { code: displayCode(digits) })}
            </Text>
          ) : (
            <CodeInput
              testID="join-code-input"
              errorTestID="join-code-error"
              value={digits}
              onChange={change}
              onComplete={submit}
              error={wrong ? joinErrorMessage(error, found?.inviterName) : null}
              autoFocus={!initialCode}
              handleRef={codeInput}
            />
          )}

          {checking ? (
            <Text
              testID="join-code-checking"
              variant="caption"
              tone="text2"
              style={{ textAlign: 'center' }}
              accessibilityLiveRegion="polite"
            >
              {t('pairing.code.checking')}
            </Text>
          ) : null}

          {found ? (
            <View
              testID="join-code-found"
              accessible
              style={{ alignItems: 'center', gap: space.xs }}
            >
              {/* Board J3: the inviter's avatar (signed, from a link: MOB-35) or their initial. */}
              <Avatar
                testID={
                  found.inviterAvatarUrl ? 'join-code-avatar-image' : 'join-code-avatar-initial'
                }
                name={name}
                isMe={false}
                imageUri={found.inviterAvatarUrl}
              />
              {found.inviterAnsweredToday ? (
                <Text tone="text2" style={{ textAlign: 'center' }}>
                  {t('pairing.code.answered', { name })}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={{ flex: 1, justifyContent: 'flex-end', gap: space.md }}>
            {coupleFailed && soloStatus.error ? (
              <>
                <Banner
                  tone="error"
                  message={messageFor(soloStatus.error.kind)}
                  testID="12-couple-error"
                />
                <Button
                  testID="12-couple-retry"
                  label={t('ui.retry')}
                  loading={soloStatus.fetching}
                  onPress={() =>
                    waiting.current ? void waitForCouple(waiting.current) : soloStatus.retry()
                  }
                />
              </>
            ) : null}
            {found ? (
              <Button
                testID="join-code-continue"
                label={t('pairing.code.continue')}
                onPress={() => router.push(status === 'signedIn' ? '/join/name' : '/join/sign-in')}
              />
            ) : null}
            {expired ? (
              <>
                {/* Board 56: ask for a new code (plain text, no link or token), or type another. */}
                <Button
                  testID="56-ask"
                  label={t('pairing.code.askNew', { name: expiredName })}
                  onPress={() =>
                    void Share.share({
                      message: t('pairing.code.askNewMessage', { code: displayCode(digits) }),
                    })
                  }
                />
                <Button
                  testID="join-code-retry"
                  variant="ghost"
                  label={t('pairing.code.otherCode')}
                  onPress={reset}
                />
              </>
            ) : error ? (
              <>
                <Button
                  testID="join-code-retry"
                  label={t('pairing.code.tryAgain')}
                  onPress={reset}
                />
                {mode === 'public' ? (
                  <Button
                    testID="join-code-own"
                    variant="ghost"
                    label={solo ? t('pairing.joinPartner.backToMine') : t('pairing.code.startOwn')}
                    onPress={startOwn}
                  />
                ) : null}
              </>
            ) : null}
            {!found && !error ? (
              <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
                {t('pairing.code.hint')}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <JoinPartnerConfirm
        visible={confirmCode !== null}
        testID="12-confirm"
        partner=""
        loading={accept.isPending}
        onConfirm={() => confirmCode && join(confirmCode, { archiveOwn: true })}
        onCancel={cancelJoin}
      />
    </SafeAreaView>
  );
}
