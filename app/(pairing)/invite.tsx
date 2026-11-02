import * as Clipboard from 'expo-clipboard';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActiveCouple } from '@/features/couple/hooks';
import { displayCode, inviteLink, spokenCode } from '@/features/pairing/invite';
import { useCreateInvite, useMyInvite, usePartnerJoined } from '@/features/pairing/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import {
  Banner,
  Button,
  haptics,
  Mascot,
  Skeleton,
  SkeletonGroup,
  Text,
  useTheme,
  useToast,
} from '@/ui';

function isFresh(expiresAt: string | undefined): boolean {
  return !!expiresAt && Date.parse(expiresAt) > Date.now();
}

/** 10 Invite partner: the 4-digit code and the link to share. Moves on by itself when they join. */
export default function PairingInviteRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const couple = useActiveCouple();
  const { joined } = usePartnerJoined();
  const { me } = useCoupleProfiles();
  const stored = useMyInvite((s) => s.invite);
  const create = useCreateInvite();
  const requested = useRef(false);

  const invite = stored && isFresh(stored.expiresAt) ? stored : null;
  const partner = couple.data?.partner_name?.trim() || t('pairing.partnerFallback');
  const coupleReady = !!couple.data;
  const { mutate } = create;

  // One invite per visit: `create_invite` revokes the previous code, so never call it twice by accident.
  useEffect(() => {
    if (invite || !coupleReady || requested.current) return;
    requested.current = true;
    mutate();
  }, [invite, coupleReady, mutate]);

  if (joined) return <Redirect href="/paired" />;
  if (couple.data === null) return <Redirect href="/" />;

  const failed = create.error ?? couple.error;

  function makeNew() {
    haptics.light();
    mutate();
  }

  async function copy() {
    if (!invite) return;
    await Clipboard.setStringAsync(displayCode(invite.code));
    haptics.success();
    useToast.getState().show(t('pairing.invite.copied'));
  }

  async function share() {
    if (!invite) return;
    const params = { code: displayCode(invite.code), link: inviteLink(invite.code, invite.token) };
    const name = me?.display_name.trim();
    const message = name
      ? t('pairing.invite.shareMessage', { ...params, name })
      : t('pairing.invite.shareMessageNoName', params);
    await Share.share({ message });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="10-screen">
      <View
        style={{
          flex: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          padding: space.gutter,
          paddingTop: space.hero,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.lg }}>
          <Mascot mood="saving-a-seat" size={140} partnerName={partner} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.invite.title', { partner })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.invite.body', { partner })}
          </Text>
          {failed ? <Banner tone="error" message={failed.message} testID="10-error" /> : null}
          <View
            testID="10-code-card"
            accessible
            accessibilityLabel={
              invite
                ? t('pairing.invite.codeA11y', { spoken: spokenCode(invite.code) })
                : t('pairing.invite.making')
            }
            style={{
              alignSelf: 'stretch',
              alignItems: 'center',
              gap: space.sm,
              padding: space.xl,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
            }}
          >
            <Text variant="caption" tone="text2">
              {t('pairing.invite.codeLabel')}
            </Text>
            {invite ? (
              <Text variant="number" tone="youText" testID="10-code">
                {displayCode(invite.code)}
              </Text>
            ) : (
              <SkeletonGroup>
                <Skeleton height={48} width={200} />
              </SkeletonGroup>
            )}
          </View>
          <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.invite.expiry')}
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          {failed && !invite ? (
            <Button testID="10-retry" label={t('ui.retry')} onPress={makeNew} />
          ) : (
            <>
              <Button
                testID="10-share"
                label={t('pairing.invite.share')}
                icon="send"
                loading={!invite}
                onPress={() => void share()}
              />
              <Button
                testID="10-copy"
                variant="ghost"
                label={t('pairing.invite.copy')}
                onPress={() => void copy()}
              />
              <Button
                testID="10-new"
                variant="link"
                label={t('pairing.invite.newCode')}
                loading={create.isPending && !!invite}
                onPress={makeNew}
              />
            </>
          )}
          <Button
            testID="10-later"
            variant="link"
            label={t('pairing.invite.later')}
            onPress={() => router.push('/waiting')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
