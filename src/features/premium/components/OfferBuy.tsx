import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { Banner, Button, useTheme } from '@/ui';

import { trackPurchaseOutcome, trackPurchaseStarted, type PurchaseContext } from '../analytics';
import { useConfirmPremium, usePurchase } from '../hooks';
import type { OfferingId, Plan, PurchaseFailure } from '../purchases';
import { PaymentFailedSheet } from './PaywallParts';

type Notice = Exclude<PurchaseFailure, 'payment' | 'unknown'> | 'confirming' | null;

/**
 * The gold "Claim 50% off" button of 15: buys the offering's plan, waits for the server
 * entitlement (like the paywall), 57 on a refused payment, inline notices otherwise. Without a
 * plan (no RevenueCat key or no such package) it says so; it never opens the paywall (D52: no 16
 * or 17 after the gift).
 */
export function OfferBuy({
  offeringId,
  plan,
  label,
  testID,
  pending = false,
}: {
  offeringId: OfferingId;
  plan: Plan | undefined;
  /** The offering is still loading: the button waits instead of saying "not available". */
  pending?: boolean;
  label: string;
  testID: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const { space } = useTheme();
  const purchase = usePurchase();
  const confirm = useConfirmPremium();
  const [notice, setNotice] = useState<Notice>(null);
  const [failed, setFailed] = useState(false);

  const buy = () => {
    if (pending) return;
    if (!plan) return setNotice('unavailable');
    if (purchase.isPending) return;
    setNotice(null);
    // Analytics (MOB-24d, §3.9): the gift coupon's purchase events are paywall `15`.
    const context: PurchaseContext = { paywall: '15', plan, offering: offeringId };
    trackPurchaseStarted(context);
    purchase.mutate(
      { offeringId, planId: plan.id },
      {
        onSuccess: ({ outcome, confirmed }) => {
          // The gift is a discount on a signed-in account (D52), never a trial.
          trackPurchaseOutcome(context, outcome, { isTrial: false, beforeSignIn: false });
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') {
            if (outcome.reason === 'payment' || outcome.reason === 'unknown') setFailed(true);
            else setNotice(outcome.reason);
            return;
          }
          // §3.9: the gift was bought (`purchase_completed` above set `plan`); never its price.
          if (offeringId === 'day3') track('gift_offer_claimed', { offer_kind: 'day3' });
          if (confirmed) router.replace('/success');
          else setNotice('confirming');
        },
      },
    );
  };

  return (
    <View style={{ gap: space.sm }}>
      {notice ? (
        <Banner
          tone="error"
          testID={`${testID}-notice-${notice}`}
          message={
            notice === 'confirming' ? t('premium.confirming') : t(`premium.errors.${notice}`)
          }
        />
      ) : null}
      {notice === 'confirming' ? (
        <Button
          testID={`${testID}-check-again`}
          variant="ghost"
          label={t('premium.checkAgain')}
          loading={confirm.isPending}
          onPress={() =>
            confirm.mutate(undefined, {
              onSuccess: (ok) => (ok ? router.replace('/success') : undefined),
            })
          }
        />
      ) : null}
      <Button
        testID={`${testID}-claim`}
        variant="premium"
        label={label}
        loading={pending || purchase.isPending || notice === 'confirming'}
        onPress={buy}
      />
      <PaymentFailedSheet
        visible={failed}
        onDismiss={() => setFailed(false)}
        onRetry={() => {
          setFailed(false);
          buy();
        }}
      />
    </View>
  );
}
