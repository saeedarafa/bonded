import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { JOIN_FROM_SOLO_ENABLED } from '@/features/pairing/flags';
import { displayCode, spokenCode } from '@/features/pairing/invite';
import { useCurrentInvite, usePartnerJoined } from '@/features/pairing/hooks';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { Button, haptics, Skeleton, Text, useTheme, useToast } from '@/ui';

type Props = { partner: string };

/**
 * D36 (design addition, PO review): while the partner hasn't joined, Today keeps the code in
 * sight. It reads the open invite from `pair_invites` (so it survives a restart) and never makes
 * a code itself: Share and "Make a new code" go to 10, which decides. D37: "Join them" for
 * someone whose partner already sent a code. Hides as soon as the partner joins.
 */
export function SoloInviteCard({ partner }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { joined } = usePartnerJoined();
  const current = useCurrentInvite(!joined);

  if (joined) return null;

  const card = {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: space.lg,
  } as const;

  const joinLink = JOIN_FROM_SOLO_ENABLED ? (
    <Button
      testID="today-join-partner"
      variant="link"
      label={t('pairing.joinPartner.cta')}
      onPress={() => router.push('/join/code')}
    />
  ) : null;

  if (current.status === 'loading') {
    return (
      <View style={card} testID="today-invite-card-loading">
        <Skeleton height={24} width="70%" />
        <Skeleton height={48} />
      </View>
    );
  }

  const invite = current.invite;
  if (current.status === 'open' && invite) {
    const code = displayCode(invite.code);
    async function copy() {
      if (!invite) return;
      await Clipboard.setStringAsync(code);
      track('pair_invite_shared', { channel: 'copy_code' });
      haptics.success();
      useToast.getState().show(t('pairing.invite.copied'));
    }
    return (
      <View style={card} testID="today-invite-card">
        <View
          accessible
          accessibilityLabel={t('pairing.soloCard.a11y', {
            partner,
            spoken: spokenCode(invite.code),
          })}
          style={{ gap: space.xs }}
        >
          <Text variant="label" testID="today-invite-title">
            {t('pairing.soloCard.title', { partner, code })}
          </Text>
          <Text variant="caption" tone="text2">
            {t('pairing.soloCard.body', { partner })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <View style={{ flexGrow: 1, flexBasis: 140 }}>
            <Button
              testID="today-invite-copy"
              variant="ghost"
              label={t('pairing.soloCard.copy')}
              onPress={() => void copy()}
            />
          </View>
          <View style={{ flexGrow: 1, flexBasis: 140 }}>
            <Button
              testID="today-invite-share"
              variant="ghost"
              icon="send"
              label={t('pairing.soloCard.share')}
              onPress={() => router.push('/invite')}
            />
          </View>
        </View>
        {joinLink}
      </View>
    );
  }

  const expired = current.status === 'expired' && current.open;
  const a11y = [
    expired && current.open
      ? t('pairing.soloCard.expiredTitle', { code: spokenCode(current.open.code) })
      : t('pairing.soloCard.noneTitle', { partner }),
    expired
      ? t('pairing.soloCard.expiredBody', { partner })
      : t('pairing.soloCard.noneBody', { partner }),
  ].join('. ');
  return (
    <View style={card} testID={expired ? 'today-invite-card-expired' : 'today-invite-card-none'}>
      <View accessible accessibilityLabel={a11y} style={{ gap: space.xs }}>
        <Text variant="label">
          {expired && current.open
            ? t('pairing.soloCard.expiredTitle', { code: displayCode(current.open.code) })
            : t('pairing.soloCard.noneTitle', { partner })}
        </Text>
        <Text variant="caption" tone="text2">
          {expired
            ? t('pairing.soloCard.expiredBody', { partner })
            : t('pairing.soloCard.noneBody', { partner })}
        </Text>
      </View>
      <Button
        testID="today-invite-new"
        variant="ghost"
        label={t('pairing.soloCard.makeNew')}
        onPress={() => router.push('/invite')}
      />
      {joinLink}
    </View>
  );
}
