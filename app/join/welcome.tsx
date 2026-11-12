import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { useLinkPreview } from '@/features/pairing/hooks';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { Avatar, Banner, Button, Mascot, Skeleton, SkeletonGroup, Text, useTheme } from '@/ui';

/**
 * J2 Personal welcome (D06, MOB-40): the first screen of an invite link with a token, before
 * sign-in. It asks `invite-preview` for the inviter's first name and signed avatar (MOB-35; the
 * initial on any avatar failure), then "Join" goes to J4 sign-in (signed out) or J5 (signed in,
 * D37). A dead link goes to the existing J9 / 56 (J3 shows what this preview said) or J10.
 * Without a link (no code, or a typed code with no name) it falls back to typing the code.
 */
export default function JoinWelcomeRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const { status } = useSession();
  const { code, token, inviterName } = usePendingInvite();
  const preview = useLinkPreview(code, token);
  const avatarUrl = preview.data?.inviterAvatarUrl ?? null;
  const knownName = preview.data?.inviterName ?? inviterName;
  // Analytics (MOB-24d, §3.4): the joiner's welcome, once it says who invited them.
  const welcomed = knownName !== null && !!code;
  useEffect(() => {
    if (welcomed) track('join_started', { via: token ? 'link' : 'code' });
  }, [welcomed, code, token]);

  if (!code || (!token && !inviterName)) return <Redirect href="/join/code" />;
  const failed = preview.error;
  if (failed?.kind === 'COUPLE_FULL') return <Redirect href="/join/full" />;
  if (failed && !failed.retryable)
    return <Redirect href={{ pathname: '/join/code', params: { code, failed: failed.kind } }} />;

  // #105: at 200% text the buttons ran past the bottom: the body scrolls (and still fills the
  // screen at default size, buttons at the bottom).
  const body = {
    flexGrow: 1,
    justifyContent: 'space-between' as const,
    gap: space.xl,
    padding: space.gutter,
    paddingTop: space.hero,
  };

  function notMine() {
    usePendingInvite.getState().clear();
    // D37: someone signed in already has their own space: back to it, not to onboarding.
    router.replace(status === 'signedIn' ? '/' : '/welcome');
  }

  // Offline or a server hiccup before we know who sent the link: say so, offer a retry.
  if (knownName === null && failed) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="J2-screen">
        <ScrollView testID="J2-scroll" contentContainerStyle={body}>
          <View style={{ alignItems: 'center', gap: space.lg }}>
            <Mascot mood="saving-a-seat" size={140} />
            <Banner tone="error" message={failed.message} testID="J2-error" />
          </View>
          <View style={{ gap: space.md }}>
            <Button testID="J2-retry" label={t('ui.retry')} onPress={preview.retry} />
            <Button
              testID="J2-no"
              variant="ghost"
              label={t('pairing.welcome.notMine')}
              onPress={notMine}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (knownName === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="J2-loading">
        <View style={{ flex: 1, padding: space.gutter, paddingTop: space.hero }}>
          <SkeletonGroup>
            <View style={{ alignItems: 'center', gap: space.lg }}>
              <Skeleton width="50%" height={36} />
              <Skeleton width={180} height={180} />
              <Skeleton width="80%" height={32} />
              <Skeleton height={48} />
            </View>
          </SkeletonGroup>
        </View>
      </SafeAreaView>
    );
  }

  const name = knownName.trim() || t('pairing.partnerFallback');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="J2-screen">
      <ScrollView testID="J2-scroll" contentContainerStyle={body}>
        <View style={{ alignItems: 'center', gap: space.lg }}>
          {/* Board J2: the inviter pill sits above the mascot. */}
          <View
            testID="J2-inviter"
            accessible
            accessibilityLabel={t('pairing.welcome.kicker', { name })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingVertical: space.xs,
              paddingLeft: space.xs,
              paddingRight: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
            }}
          >
            <Avatar
              testID={avatarUrl ? 'J2-avatar-image' : 'J2-avatar-initial'}
              name={name}
              isMe={false}
              size="sm"
              imageUri={avatarUrl}
            />
            <Text variant="label">{t('pairing.welcome.kicker', { name })}</Text>
          </View>
          <Mascot mood="together" size={180} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.welcome.title', { name })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.welcome.body')}
          </Text>
        </View>
        <View style={{ gap: space.md }}>
          <Button
            testID="J2-join"
            label={t('pairing.welcome.join', { name })}
            onPress={() => router.push(status === 'signedIn' ? '/join/name' : '/join/sign-in')}
          />
          <Button
            testID="J2-no"
            variant="ghost"
            label={t('pairing.welcome.notMine')}
            onPress={notMine}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
