import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { useJoinPartner } from '@/features/pairing/hooks';
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

  if (!code) return <Redirect href="/join/code" />;
  if (status === 'signedOut') return <Redirect href="/join/sign-in" />;

  const partner = inviterName?.trim() || '';
  const me = name.trim();

  function submit() {
    if (!me) {
      setMissing(true);
      haptics.error();
      return;
    }
    if (!userId || !code || join.isPending) return;
    join.mutate(
      { userId, displayName: me, code, token },
      {
        onSuccess: () => router.replace('/join/reminders'),
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
            <Banner tone="error" message={join.error.message} testID="J5-error" />
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
    </SafeAreaView>
  );
}
