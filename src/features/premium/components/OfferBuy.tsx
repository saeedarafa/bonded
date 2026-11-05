import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Banner, Button, useTheme } from '@/ui';

import { useConfirmPremium, usePurchase } from '../hooks';
import type { OfferingId, Plan, PurchaseFailure } from '../purchases';
import { PaymentFailedSheet } from './PaywallParts';

type Notice = Exclude<PurchaseFailure, 'payment' | 'unknown'> | 'confirming' | null;

/**
 * The gold "claim" button of 15 / 36: buys the offering's plan, waits for the server entitlement
 * (like the paywall), 57 on a refused payment, inline notices otherwise. Without a plan (no
 * RevenueCat key or no such package) it opens the paywall, which explains.
 */
export function OfferBuy({
  offeringId,
  plan,
  label,
  testID,
}: {
  offeringId: OfferingId;
  plan: Plan | undefined;
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
    if (!plan) return router.push('/paywall');
    if (purchase.isPending) return;
    setNotice(null);
    purchase.mutate(
      { offeringId, planId: plan.id },
      {
        onSuccess: ({ outcome, confirmed }) => {
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') {
            if (outcome.reason === 'payment' || outcome.reason === 'unknown') setFailed(true);
            else setNotice(outcome.reason);
            return;
          }
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
        loading={purchase.isPending || notice === 'confirming'}
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
