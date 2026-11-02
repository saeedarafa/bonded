import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { useAcceptInvite, useInvitePreview } from '@/features/pairing/hooks';
import type { InvitePreview } from '@/features/pairing/api';
import { useTranslation } from '@/i18n';
import type { AppError } from '@/lib/errors';
import { Button, CodeInput, haptics, Mascot, Text, TopBar, useTheme } from '@/ui';

type Props = {
  /** `public`: before sign-in, previews the inviter (J3, J9, 56). `account`: signed in, joins at once (12). */
  mode: 'public' | 'account';
  /** The four digits to start with (from the link or the route). */
  initialCode: string;
  onBack: () => void;
};

/**
 * One code-entry screen for J3 (code filled from the link), J9 (wrong code), 56 (expired) and 12
 * (signed-in "Join with code"). Every submit counts against the 5-failures-per-15-minutes limiter
 * (BE-04), so it only runs when the 4th digit lands, never on its own.
 */
export function JoinCodeView({ mode, initialCode, onBack }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status } = useSession();
  const pending = usePendingInvite();
  const preview = useInvitePreview();
  const accept = useAcceptInvite();
  const [digits, setDigits] = useState(initialCode);
  const [found, setFound] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const submitted = useRef('');

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
    if (submitted.current === code) return;
    submitted.current = code;
    setError(null);
    setFound(null);
    const token = tokenFor(code);
    if (mode === 'public') {
      preview.mutate(
        { code, token },
        {
          onSuccess: (result) => {
            haptics.success();
            usePendingInvite.getState().set({ code, token, inviterName: result.inviterName });
            setFound(result);
          },
          onError: fail,
        },
      );
    } else {
      accept.mutate({ code, token }, { onSuccess: () => router.replace('/paired'), onError: fail });
    }
  }

  function change(next: string) {
    setDigits(next);
    if (next.length < 4) {
      submitted.current = '';
      setError(null);
      setFound(null);
    }
  }

  function reset() {
    submitted.current = '';
    setDigits('');
    setError(null);
    setFound(null);
  }

  function startOwn() {
    usePendingInvite.getState().clear();
    router.replace('/welcome');
  }

  const checking = preview.isPending || accept.isPending;
  const expired = error?.kind === 'INVITE_EXPIRED';
  const wrong = !!error && !expired;
  const name = found?.inviterName.trim() || t('pairing.partnerFallback');

  const title = expired
    ? t('pairing.code.expiredTitle')
    : found
      ? t('pairing.code.titleFound', { name })
      : t('pairing.code.title');
  const body = expired
    ? t('pairing.code.expiredBody')
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
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: space.xl,
          paddingHorizontal: space.gutter,
          paddingVertical: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
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

        {expired ? null : (
          <CodeInput
            testID="join-code-input"
            errorTestID="join-code-error"
            value={digits}
            onChange={change}
            onComplete={submit}
            error={wrong ? error.message : null}
            autoFocus={!initialCode}
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
          <View testID="join-code-found" accessible style={{ alignItems: 'center', gap: space.xs }}>
            {found.inviterAnsweredToday ? (
              <Text tone="text2" style={{ textAlign: 'center' }}>
                {t('pairing.code.answered', { name })}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={{ flex: 1, justifyContent: 'flex-end', gap: space.md }}>
          {found ? (
            <Button
              testID="join-code-continue"
              label={t('pairing.code.continue')}
              onPress={() => router.push(status === 'signedIn' ? '/join/name' : '/join/sign-in')}
            />
          ) : null}
          {error ? (
            <>
              <Button testID="join-code-retry" label={t('pairing.code.tryAgain')} onPress={reset} />
              {mode === 'public' ? (
                <Button
                  testID="join-code-own"
                  variant="ghost"
                  label={t('pairing.code.startOwn')}
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
    </SafeAreaView>
  );
}
