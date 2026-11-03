import * as Clipboard from 'expo-clipboard';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActiveCouple } from '@/features/couple/hooks';
import { ConfirmSheet } from '@/features/pairing/components/ConfirmSheet';
import { JOIN_FROM_SOLO_ENABLED } from '@/features/pairing/flags';
import { displayCode, spokenCode } from '@/features/pairing/invite';
import {
  useCreateInvite,
  useCurrentInvite,
  useInviteLink,
  usePartnerJoined,
} from '@/features/pairing/hooks';
import { shareInviteMessage } from '@/features/pairing/share';
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

/**
 * 10 Invite partner: the 4-digit code and the link to share. Moves on by itself when they join.
 * D36: the code someone may already have is never replaced silently. The open invite comes from
 * `pair_invites` (it survives a restart); `create_invite` runs by itself only when there is no open,
 * unexpired code, and "Make a new code" asks first.
 */
export default function PairingInviteRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const couple = useActiveCouple();
  const { joined } = usePartnerJoined();
  const { me } = useCoupleProfiles();
  const coupleReady = !!couple.data;
  const current = useCurrentInvite(coupleReady);
  const create = useCreateInvite();
  const link = useInviteLink();
  const requested = useRef(false);
  const [confirmNew, setConfirmNew] = useState(false);

  const invite = current.invite;
  const partner = couple.data?.partner_name?.trim() || t('pairing.partnerFallback');
  const { mutate } = create;
  // Only once we KNOW there is no usable code (loaded, not an error): creating revokes the old one.
  const noCode = current.status === 'none' || current.status === 'expired';
  const canAutoCreate = coupleReady && noCode && !current.error;

  // At most one automatic invite per visit.
  useEffect(() => {
    if (!canAutoCreate || requested.current) return;
    requested.current = true;
    mutate();
  }, [canAutoCreate, mutate]);

  if (joined) return <Redirect href="/paired" />;
  if (couple.data === null) return <Redirect href="/" />;

  const failed = create.error ?? current.error ?? couple.error;

  function retry() {
    haptics.light();
    if (current.error) current.refetch();
    else mutate();
  }

  function askNew() {
    haptics.light();
    setConfirmNew(true);
  }

  function makeNew() {
    mutate(undefined, { onSettled: () => setConfirmNew(false) });
  }

  async function copy() {
    if (!invite) return;
    await Clipboard.setStringAsync(displayCode(invite.code));
    haptics.success();
    useToast.getState().show(t('pairing.invite.copied'));
  }

  async function share() {
    if (!invite || link.isPending) return;
    let token = invite.token;
    if (!token) {
      // A link for the SAME code (BE-28). Any failure (not deployed yet, RATE_LIMITED, offline)
      // still shares the code on its own: never `create_invite` just to get a link.
      const fresh = await link.mutateAsync().catch(() => null);
      token = fresh && fresh.code === invite.code ? fresh.token : null;
    }
    await Share.share({
      message: shareInviteMessage(invite.code, token, me?.display_name),
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="10-screen">
      {/* Scrolls on small phones and at large text sizes, so every action stays reachable (iPhone SE). */}
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
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
            <Button testID="10-retry" label={t('ui.retry')} onPress={retry} />
          ) : (
            <>
              <Button
                testID="10-share"
                label={t('pairing.invite.share')}
                icon="send"
                loading={!invite || link.isPending}
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
                onPress={askNew}
              />
            </>
          )}
          {JOIN_FROM_SOLO_ENABLED ? (
            <Button
              testID="10-join-partner"
              variant="link"
              label={t('pairing.joinPartner.cta')}
              onPress={() => router.push('/join/code')}
            />
          ) : null}
          <Button
            testID="10-later"
            variant="link"
            label={t('pairing.invite.later')}
            onPress={() => router.push('/waiting')}
          />
        </View>
      </ScrollView>
      <ConfirmSheet
        visible={confirmNew}
        testID="10-new-confirm"
        title={t('pairing.invite.newConfirmTitle')}
        body={t('pairing.invite.newConfirmBody', {
          code: invite ? displayCode(invite.code) : '',
          partner,
        })}
        confirmLabel={t('pairing.invite.newConfirm')}
        tone="destructive"
        loading={create.isPending}
        onConfirm={makeNew}
        onCancel={() => setConfirmNew(false)}
      />
    </SafeAreaView>
  );
}
