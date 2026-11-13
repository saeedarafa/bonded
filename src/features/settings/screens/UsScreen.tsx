import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnalyticsConsent } from '@/features/analytics/useAnalytics';
import { useSignOut } from '@/features/auth/hooks';
import { isCoupleComplete } from '@/features/couple/hooks';
import { useStreak } from '@/features/daily/hooks';
import { togetherSince } from '@/features/daily/today';
import { TimePicker } from '@/features/onboarding/TimePickerSheet';
import { CancelOfferSheet } from '@/features/premium/components/ExitOffer';
import {
  useCancelOfferGate,
  useCancelOfferPurchase,
  useGiftPromo,
  usePremium,
  useRestore,
} from '@/features/premium/hooks';
import { manageSubscriptionsUrl, type CancelOffer } from '@/features/premium/purchases';
import { RITUAL_TIMES, shortTime } from '@/features/push/ritual';
import { suppressReviewThisSession } from '@/features/review/review';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { inviteDomain, supportEmail } from '@/lib/env';
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

import { SettingsGroup, SettingsRow, SettingsToggleRow } from '../components/SettingsList';
import { feedbackMailto, mailAppVersion, mailPlatform } from '../feedbackMail';
import { useNotificationPrefs, usePairNames, useSaveNotificationPrefs } from '../hooks';
import { shortDate } from '../model';

/**
 * 40 Us & settings (Us tab). Header card with the pair, then the board's three groups. Delete
 * account is two taps from the tab (row, then "Delete forever" on 43). Premium state is the
 * server's (`usePremium`), never the SDK's. "Share usage data" (D54, MOB-24b) is not on the board:
 * it uses the board's toggle row (41) in the third group, next to Privacy.
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
  // D52: while the day-3 gift is live, the Premium row shows it too (and opens it, not 16).
  const gift = useGiftPromo();
  const restore = useRestore();
  // D57 (2): Manage subscription → at most one offer screen (iOS) → the store page.
  const cancelGate = useCancelOfferGate();
  const cancelPurchase = useCancelOfferPurchase();
  const [cancelOffer, setCancelOffer] = useState<CancelOffer | null>(null);
  const [cancelDeciding, setCancelDeciding] = useState(false);
  const signOut = useSignOut();
  // D54 (MOB-24b): "Share usage data", on by default, stored on this device.
  const sharing = useAnalyticsConsent((s) => s.sharing);
  const setSharing = useAnalyticsConsent((s) => s.setSharing);
  // 'ritualPicker': the ritual sheet showing "Pick another time" (MOB-72) instead of the presets.
  const [sheet, setSheet] = useState<'ritual' | 'ritualPicker' | 'signOut' | null>(null);
  const [ritualError, setRitualError] = useState<string | null>(null);

  const ritual = prefs.data?.ritual_time ? shortTime(prefs.data.ritual_time) : null;
  // A custom time (picked on N or here, PO 2026-11-11) is shown as its own selected row.
  const customRitual = ritual && !RITUAL_TIMES.some((r) => r.time === ritual) ? ritual : null;
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

  // D62: "Send feedback" emails the support mailbox (hidden while it is not configured).
  const support = supportEmail();
  const sendFeedback = (to: string) => () => {
    track('feedback_opened', { via: 'email' });
    const body = t('settings.us.feedbackBody', {
      version: mailAppVersion(),
      platform: mailPlatform(Platform.OS),
    });
    const url = feedbackMailto({ to, subject: t('settings.us.feedbackSubject'), body });
    void Linking.openURL(url).catch(() => {});
  };

  /** The store's own subscription page (cancel happens there, never in the app). */
  const openStorePage = () => {
    track('cancel_continued', { store: Platform.OS === 'ios' ? 'app_store' : 'play_store' });
    void Linking.openURL(manageSubscriptionsUrl(Platform.OS)).catch(() => {});
  };
  // D57 (2): iOS asks the server (once per person, ever) and RevenueCat for the `cancel30` offer;
  // no offer (or Android, v1) = straight to the store page.
  const manageSubscription = () => {
    if (cancelDeciding) return;
    // D62: the cancel flow silences the review prompt for the rest of the session.
    suppressReviewThisSession('cancel');
    if (Platform.OS !== 'ios') return openStorePage();
    setCancelDeciding(true);
    void cancelGate(Platform.OS).then((offer) => {
      setCancelDeciding(false);
      if (!offer) return openStorePage();
      track('exit_offer_viewed', { trigger: 'cancel' });
      setCancelOffer(offer);
    });
  };

  let premiumValue: string | null = null;
  let onPremium: (() => void) | undefined;
  if (premium.status === 'ready') {
    if (premium.isPremium && premium.viaPartner) {
      premiumValue = t('settings.us.premiumPartner', { partner });
    } else if (premium.isPremium) {
      premiumValue = t('settings.us.premiumMine');
      onPremium = manageSubscription;
    } else if (gift) {
      premiumValue = gift.opened
        ? t('offers.settings.live', { percent: gift.percent, time: gift.time })
        : t('offers.settings.unopened');
      onPremium = () => router.push(gift.href);
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
            valueTone={premium.isPremium || gift !== null ? 'premiumText' : 'text3'}
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
          <SettingsToggleRow
            testID="40-share-usage"
            label={t('settings.us.shareUsage')}
            description={t('settings.us.shareUsageBody')}
            value={sharing}
            onValueChange={(next) => void setSharing(next)}
          />
          <SettingsRow
            testID="40-help"
            label={t('settings.us.help')}
            chevron
            onPress={() => router.push('/us/feedback')}
          />
          {support ? (
            <SettingsRow
              testID="40-send-feedback"
              label={t('settings.us.sendFeedback')}
              chevron
              onPress={sendFeedback(support)}
            />
          ) : null}
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
        visible={sheet === 'ritual' || sheet === 'ritualPicker'}
        onDismiss={() => {
          // Closing the picker goes back to the presets; closing the presets closes the sheet.
          setRitualError(null);
          setSheet(sheet === 'ritualPicker' ? 'ritual' : null);
        }}
        title={t(
          sheet === 'ritualPicker' ? 'settings.ritual.pickerTitle' : 'settings.ritual.title',
        )}
        testID="40-ritual-sheet"
      >
        {sheet === 'ritualPicker' ? (
          <View style={{ gap: space.md }} testID="40-ritual-picker">
            <TimePicker
              testID="40-ritual-picker"
              initial={ritual ?? '21:00'}
              busy={savePrefs.isPending}
              onPick={pickRitual}
            />
            {ritualError ? (
              <Banner tone="error" message={ritualError} testID="40-ritual-error" />
            ) : null}
          </View>
        ) : (
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
            {customRitual ? (
              <OptionRow
                testID="40-ritual-custom"
                label={t('settings.ritual.custom')}
                trailing={customRitual}
                selected
                onPress={() => {
                  setRitualError(null);
                  setSheet('ritualPicker');
                }}
              />
            ) : null}
            <Button
              testID="40-ritual-other"
              variant="link"
              label={t('settings.ritual.other')}
              onPress={() => {
                setRitualError(null);
                setSheet('ritualPicker');
              }}
            />
            {ritualError ? (
              <Banner tone="error" message={ritualError} testID="40-ritual-error" />
            ) : null}
          </View>
        )}
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
      <CancelOfferSheet
        visible={cancelOffer !== null}
        offer={cancelOffer}
        busy={cancelPurchase.isPending}
        onTake={() => {
          const offer = cancelOffer;
          if (!offer || cancelPurchase.isPending) return;
          cancelPurchase.mutate(offer, {
            onSuccess: (outcome) => {
              if (outcome.kind === 'cancelled') return;
              if (outcome.kind === 'failed') {
                return showToast(t('offers.cancel.failed'), 'error');
              }
              track('exit_offer_claimed', { trigger: 'cancel' });
              setCancelOffer(null);
              showToast(t('offers.cancel.done', { percent: offer.percent }), 'success');
            },
          });
        }}
        onContinue={() => {
          track('exit_offer_dismissed', { trigger: 'cancel' });
          setCancelOffer(null);
          openStorePage();
        }}
        onClose={() => {
          track('exit_offer_dismissed', { trigger: 'cancel' });
          setCancelOffer(null);
        }}
      />
    </SafeAreaView>
  );
}
