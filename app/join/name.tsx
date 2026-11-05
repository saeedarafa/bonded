import { Redirect, useRouter } from 'expo-router';
import { type ComponentRef, useRef, useState } from 'react';
import { Keyboard, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { JoinPartnerConfirm } from '@/features/pairing/components/JoinPartnerConfirm';
import { useJoinPartner } from '@/features/pairing/hooks';
import { joinErrorMessage } from '@/features/pairing/joinRequest';
import { NAME_MAX } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import {
  AvatarPair,
  Banner,
  Button,
  haptics,
  ProgressBar,
  Text,
  TextField,
  TopBar,
  useTheme,
} from '@/ui';

const STEP = 2;
const STEPS = 3;

/** J5 Your name (2 of 3). Saving it also joins the inviter's couple; stage and dates come with it. */
export default function JoinNameRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status, userId } = useSession();
  const { code, token, inviterName } = usePendingInvite();
  const join = useJoinPartner();
  const [name, setName] = useState('');
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const nameInput = useRef<ComponentRef<typeof TextInput>>(null);
  // D37: someone who started their own space joins a partner: ask first, their space is archived.
  const couple = useActiveCouple({ enabled: status === 'signedIn' });
  const solo = !!couple.data && !isCoupleComplete(couple.data);

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
    if (!userId || !code || join.isPending) return;
    if (solo) {
      haptics.light();
      nameInput.current?.blur();
      Keyboard.dismiss();
      setConfirming(true);
      return;
    }
    startJoin();
  }

  /** D37 sheet "Join": the only way a solo joiner reaches `accept_invite`. */
  function confirmJoin() {
    if (!confirming || !me || !userId || !code || join.isPending) return;
    startJoin();
  }

  function startJoin() {
    if (!userId || !code) return;
    join.mutate(
      { userId, displayName: me, code, token },
      {
        // A typed code waits for the inviter's yes (BE-26); a link token joins at once.
        onSuccess: (result) =>
          router.replace(result.kind === 'pending' ? '/join/pending' : '/join/reminders'),
        onSettled: () => setConfirming(false),
        onError: (e) => {
          haptics.error();
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="J5-screen">
      <TopBar
        testID="J5-top"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/join/code'))}
        center={
          <ProgressBar value={STEP / STEPS} label={t('ui.stepOf', { step: STEP, total: STEPS })} />
        }
        right={
          <Text variant="caption" tone="text2" importantForAccessibility="no-hide-descendants">
            {t('ui.stepCount', { step: STEP, total: STEPS })}
          </Text>
        }
      />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          paddingHorizontal: space.gutter,
          paddingVertical: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
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
        </View>
        <View style={{ gap: space.md }}>
          {join.error ? (
            <Banner
              tone="error"
              message={joinErrorMessage(join.error, partner)}
              testID="J5-error"
            />
          ) : null}
          <Button
            testID="J5-join"
            label={
              partner ? t('pairing.name.join', { name: partner }) : t('pairing.name.joinNoName')
            }
            loading={join.isPending}
            onPress={submit}
          />
        </View>
      </ScrollView>
      <JoinPartnerConfirm
        visible={confirming}
        testID="J5-confirm"
        partner={partner}
        loading={join.isPending}
        onConfirm={confirmJoin}
        onCancel={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}
