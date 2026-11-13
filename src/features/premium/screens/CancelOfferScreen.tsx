import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { Button, Icon, Mascot, Skeleton, SkeletonGroup, Text, useTheme, useToast } from '@/ui';

import { clearHeldCancelOffer, peekHeldCancelOffer } from '../cancelOffer';
import { useCancelOfferGate, useCancelOfferPurchase } from '../hooks';
import { manageSubscriptionsUrl, type CancelOffer } from '../purchases';

/** The store's own subscription page (cancel happens there, never in the app). */
export function openStoreSubscriptions(os: string = Platform.OS): void {
  track('cancel_continued', { store: os === 'ios' ? 'app_store' : 'play_store' });
  void Linking.openURL(manageSubscriptionsUrl(os)).catch(() => {});
}

/** The struck regular price, then the offer price: both the store's own strings. */
function PriceLine({ offer }: { offer: CancelOffer }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={t('offers.cancel.priceA11y', {
        offer: offer.offerPrice,
        was: offer.regularPrice,
      })}
      testID="cancel-offer-price"
      style={{ alignItems: 'center', gap: space.xs }}
    >
      <Text variant="h2" testID="cancel-offer-price-offer">
        {offer.offerPrice}
      </Text>
      <Text tone="text2">
        <Text
          tone="text2"
          testID="cancel-offer-price-was"
          style={{ textDecorationLine: 'line-through' }}
        >
          {offer.regularPrice}
        </Text>
        {` · ${t('offers.cancel.nextYear')}`}
      </Text>
    </View>
  );
}

/**
 * MOB-84 (D61 (2)/(3), D57 (2)): the one offer screen for a trial or Yearly subscriber on iOS who
 * is about to cancel. Reached from Settings/Us → Manage subscription (the offer already cleared
 * there) or from the `cancel_offer` push (`bonded://subscription/offer`), which asks here: the
 * store's `cancel30` promotional offer on the person's own running App Store subscription, then
 * `open_exit_offer('cancel')` (once per person, ever). Any "no" (Android, the period ended, a
 * partner's purchase, shown before, an error) opens the store page instead and leaves. Prices and
 * the percentage come from the store. "Continue to cancel" opens the store page at once, so
 * cancelling stays Manage subscription → Continue to cancel; ×, the link and Android back always
 * leave, never blocked or delayed.
 */
export default function CancelOfferScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const showToast = useToast((s) => s.show);
  const gate = useCancelOfferGate();
  const purchase = useCancelOfferPurchase();
  const [offer, setOffer] = useState<CancelOffer | null>(() => peekHeldCancelOffer());
  const asked = useRef(false);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/us'));

  useEffect(() => {
    // Read once: the next visit (a push later) asks the server itself.
    clearHeldCancelOffer();
    if (offer || asked.current) return;
    asked.current = true;
    void gate(Platform.OS).then((found) => {
      if (!found) {
        openStoreSubscriptions();
        leave();
        return;
      }
      track('exit_offer_viewed', { trigger: 'cancel' });
      setOffer(found);
    });
    // Asked once per visit; the held offer is read on the first render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    track('exit_offer_dismissed', { trigger: 'cancel' });
    leave();
  };
  const take = () => {
    if (!offer || purchase.isPending) return;
    purchase.mutate(offer, {
      onSuccess: (outcome) => {
        if (outcome.kind === 'cancelled') return;
        if (outcome.kind === 'failed') return showToast(t('offers.cancel.failed'), 'error');
        track('exit_offer_claimed', { trigger: 'cancel' });
        showToast(t('offers.cancel.done', { percent: offer.percent }), 'success');
        leave();
      },
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="cancel-offer-screen">
      <View style={{ alignItems: 'flex-end', paddingHorizontal: space.gutter }}>
        <Pressable
          testID="cancel-offer-close"
          accessibilityRole="button"
          accessibilityLabel={t('offers.cancel.close')}
          hitSlop={12}
          onPress={dismiss}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" color={colors.text2} />
        </Pressable>
      </View>
      {!offer ? (
        <SkeletonGroup testID="cancel-offer-loading">
          <Skeleton height={200} />
          <Skeleton height={56} />
        </SkeletonGroup>
      ) : (
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            gap: space.xl,
            padding: space.gutter,
          }}
        >
          <View style={{ alignItems: 'center', gap: space.md }}>
            <Mascot mood="snuggled" size={120} />
            <Text
              variant="h1"
              accessibilityRole="header"
              style={{ textAlign: 'center' }}
              testID="cancel-offer-title"
            >
              {t('offers.cancel.title', { percent: offer.percent })}
            </Text>
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.cancel.body')}
            </Text>
            <PriceLine offer={offer} />
            <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.cancel.note')}
            </Text>
          </View>
          <View style={{ gap: space.md }}>
            <Button
              testID="cancel-offer-take"
              variant="premium"
              label={t('offers.cancel.take', { percent: offer.percent })}
              loading={purchase.isPending}
              onPress={take}
            />
            <Button
              testID="cancel-offer-continue"
              variant="ghost"
              label={t('offers.cancel.continue')}
              onPress={() => {
                track('exit_offer_dismissed', { trigger: 'cancel' });
                openStoreSubscriptions();
                leave();
              }}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
