import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSignOut } from '@/features/auth/hooks';
import { isCoupleComplete } from '@/features/couple/hooks';
import { useStreak } from '@/features/daily/hooks';
import { togetherSince } from '@/features/daily/today';
import { usePremium, useRestore } from '@/features/premium/hooks';
import { manageSubscriptionsUrl } from '@/features/premium/purchases';
import { RITUAL_TIMES, shortTime } from '@/features/push/ritual';
import { useTranslation } from '@/i18n';
import { inviteDomain } from '@/lib/env';
import {
  AvatarPair,
  Banner,
  Button,
  Mascot,
  OfflineBanner,
  OptionRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  Text,
  useTheme,
  useToast,
} from '@/ui';

import { SettingsGroup, SettingsRow } from '../components/SettingsList';
import { useNotificationPrefs, usePairNames, useSaveNotificationPrefs } from '../hooks';
import { shortDate } from '../model';

/**
 * 40 Us & settings (Us tab). Header card with the pair, then the board's three groups. Delete
 * account is two taps from the tab (row, then "Delete forever" on 43). Premium state is the
 * server's (`usePremium`), never the SDK's.
 */
export default function UsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, radius, space } = useTheme();
  const showToast = useToast((s) => s.show);
  const { couple, me, partner } = usePairNames();
  const paired = isCoupleComplete(couple.data);
  const streak = useStreak({ enabled: paired });
  const prefs = useNotificationPrefs();
  const savePrefs = useSaveNotificationPrefs();
  const premium = usePremium();
  const restore = useRestore();
  const signOut = useSignOut();
  const [sheet, setSheet] = useState<'ritual' | 'signOut' | null>(null);
  const [ritualError, setRitualError] = useState<string | null>(null);

  const ritual = prefs.data?.ritual_time ? shortTime(prefs.data.ritual_time) : null;
  const since = couple.data ? shortDate(togetherSince(couple.data), false, i18n.language) : null;
  const subtitle = paired
    ? [
        since ? t('settings.us.pairedSince', { date: since }) : null,
        streak.data && streak.data.current > 0
          ? t('settings.us.streak', { count: streak.data.current })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : t('settings.us.waiting', { partner });

  let premiumValue: string | null = null;
  let onPremium: (() => void) | undefined;
  if (premium.status === 'ready') {
    if (premium.isPremium && premium.viaPartner) {
      premiumValue = t('settings.us.premiumPartner', { partner });
    } else if (premium.isPremium) {
      premiumValue = t('settings.us.premiumMine');
      onPremium = () => void Linking.openURL(manageSubscriptionsUrl(Platform.OS)).catch(() => {});
    } else {
      premiumValue = t('settings.us.premiumFree');
      onPremium = () => router.push({ pathname: '/paywall', params: { from: 'settings' } });
    }
  }

  const doRestore = () => {
    if (restore.isPending) return;
    restore.mutate(undefined, {
      onSuccess: ({ outcome, confirmed }) => {
        if (confirmed) showToast(t('settings.us.restored'));
        else if (outcome.kind === 'restored') {
          showToast(t('premium.errors.restoreNothing'), 'info');
        } else showToast(t('premium.errors.restoreFailed'), 'error');
      },
      onError: () => showToast(t('premium.errors.restoreFailed'), 'error'),
    });
  };

  const pickRitual = (time: string) => {
    setRitualError(null);
    savePrefs.mutate(
      { ritual_time: time },
      {
        onSuccess: () => setSheet(null),
        onError: () => setRitualError(t('settings.ritual.saveError')),
      },
    );
  };

  const domain = inviteDomain();

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="40-screen"
    >
      <OfflineBanner />
      <View style={{ paddingHorizontal: space.gutter, paddingVertical: space.md }}>
        <Text variant="h1" accessibilityRole="header">
          {t('settings.us.title')}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: space.xl,
          gap: space.md,
        }}
      >
        {couple.error && !couple.data ? (
          <View style={{ gap: space.md }} testID="40-error">
            <Banner tone="error" message={couple.error.message || t('settings.us.loadError')} />
            <Button label={t('ui.retry')} onPress={() => void couple.refetch()} />
          </View>
        ) : couple.data === undefined ? (
          <SkeletonGroup testID="40-loading">
            <Skeleton height={72} />
          </SkeletonGroup>
        ) : couple.data ? (
          <View
            testID="40-header"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card - 2,
            }}
          >
            <AvatarPair meName={me} partnerName={partner} />
            <View style={{ flex: 1 }}>
              <Text variant="label">{t('settings.us.pair', { me, partner })}</Text>
              {subtitle ? (
                <Text
                  variant="caption"
                  tone="text3"
                  style={{ fontVariant: ['tabular-nums'] }}
                  testID="40-subtitle"
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Mascot
              mood={paired ? 'together' : 'saving-a-seat'}
              size={44}
              partnerName={partner}
              accessibilityLabel={t('settings.us.mascot')}
            />
          </View>
        ) : null}

        <SettingsGroup>
          <SettingsRow
            testID="40-ritual"
            label={t('settings.us.ritualTime')}
            value={ritual}
            chevron
            onPress={() => {
              setRitualError(null);
              setSheet('ritual');
            }}
          />
          <SettingsRow
            testID="40-notifications"
            label={t('settings.us.notifications')}
            chevron
            onPress={() => router.push('/us/notifications')}
          />
          <SettingsRow
            testID="40-couple"
            label={t('settings.us.couple')}
            chevron
            onPress={() => router.push('/us/couple')}
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            testID="40-premium"
            label={t('settings.us.premium')}
            value={premiumValue}
            valueTone={premium.isPremium ? 'premiumText' : 'text3'}
            onPress={onPremium}
          />
          <SettingsRow
            testID="40-restore"
            label={t('settings.us.restore')}
            value={restore.isPending ? '…' : null}
            chevron
            onPress={doRestore}
          />
        </SettingsGroup>

        <SettingsGroup>
          {domain ? (
            <SettingsRow
              testID="40-privacy"
              label={t('settings.us.privacy')}
              chevron
              onPress={() => void Linking.openURL(`https://${domain}/privacy`).catch(() => {})}
            />
          ) : null}
          <SettingsRow
            testID="40-help"
            label={t('settings.us.help')}
            chevron
            onPress={() => router.push('/us/feedback')}
          />
          <SettingsRow
            testID="40-sign-out"
            label={t('settings.us.signOut')}
            onPress={() => setSheet('signOut')}
          />
          <SettingsRow
            testID="40-delete"
            label={t('settings.us.delete')}
            destructive
            onPress={() => router.push('/us/delete')}
          />
        </SettingsGroup>
      </ScrollView>

      <Sheet
        visible={sheet === 'ritual'}
        onDismiss={() => setSheet(null)}
        title={t('settings.ritual.title')}
        testID="40-ritual-sheet"
      >
        <View style={{ gap: space.md }}>
          <Text tone="text2">{t('settings.ritual.body')}</Text>
          {RITUAL_TIMES.map((r) => (
            <OptionRow
              key={r.id}
              testID={`40-ritual-${r.id}`}
              label={t(`push.ritual.${r.id}`)}
              trailing={r.time}
              selected={ritual === r.time}
              onPress={() => pickRitual(r.time)}
            />
          ))}
          {ritualError ? (
            <Banner tone="error" message={ritualError} testID="40-ritual-error" />
          ) : null}
        </View>
      </Sheet>

      <Sheet
        visible={sheet === 'signOut'}
        onDismiss={() => setSheet(null)}
        title={t('settings.signOut.title')}
        testID="40-sign-out-sheet"
      >
        <View style={{ gap: space.md }}>
          <Text tone="text2">{t('settings.signOut.body')}</Text>
          {signOut.error ? (
            <Banner tone="error" message={signOut.error.message} testID="40-sign-out-error" />
          ) : null}
          <Button
            testID="40-sign-out-confirm"
            label={t('settings.signOut.confirm')}
            loading={signOut.isPending}
            onPress={() => signOut.mutate()}
          />
          <Button
            testID="40-sign-out-cancel"
            variant="link"
            label={t('settings.signOut.cancel')}
            onPress={() => setSheet(null)}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
