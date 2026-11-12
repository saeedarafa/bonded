import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Button, Icon, Mascot, Sheet, Text, useTheme } from '@/ui';

import type { CancelOffer, Plan } from '../purchases';

/** The struck regular price, then the offer price: both the store's own strings. */
function PriceLine({
  was,
  offer,
  suffix,
  label,
  testID,
}: {
  was: string;
  offer: string;
  suffix: string;
  label: string;
  testID: string;
}) {
  const { space } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={label}
      testID={testID}
      style={{ alignItems: 'center', gap: space.xs }}
    >
      <Text variant="h2" testID={`${testID}-offer`}>
        {offer}
      </Text>
      <Text tone="text2">
        <Text tone="text2" testID={`${testID}-was`} style={{ textDecorationLine: 'line-through' }}>
          {was}
        </Text>
        {` · ${suffix}`}
      </Text>
    </View>
  );
}

function CloseButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="close" color={colors.text2} />
    </Pressable>
  );
}

/**
 * D57 (1): the exit offer sheet on the person's **first** × of P3 or 16 (instead of 17, once per
 * person, ever). "30% off your first year" on Yearly: the percentage, the struck regular price and
 * the offer price all come from the `exit30` offering's plan (`percent` = `introPercent(plan)`,
 * rounded down; nothing hard-coded). "Take 30% off" buys it; "No thanks, continue free", ×, the
 * backdrop and Android back all close, never blocked or delayed. Copy: warm, no pressure
 * (COPY_GUIDE § Offers).
 */
export function ExitOfferSheet({
  visible,
  plan,
  percent,
  busy = false,
  onTake,
  onClose,
}: {
  visible: boolean;
  plan: Plan | null;
  percent: number | null;
  busy?: boolean;
  onTake: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const intro = plan?.introOffer ?? null;
  const ready = plan !== null && intro !== null && percent !== null;
  return (
    <Sheet visible={visible && ready} onDismiss={onClose} testID="exit-offer-sheet">
      {ready ? (
        <>
          <View style={{ alignItems: 'flex-end' }}>
            <CloseButton
              testID="exit-offer-close"
              label={t('offers.exit.close')}
              onPress={onClose}
            />
          </View>
          <View style={{ alignItems: 'center', gap: space.md }}>
            <Mascot mood="snuggled" size={56} accessibilityLabel={t('offers.exit.mascot')} />
            <Text
              variant="h2"
              accessibilityRole="header"
              style={{ textAlign: 'center' }}
              testID="exit-offer-title"
            >
              {t('offers.exit.title', { percent })}
            </Text>
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.exit.body')}
            </Text>
            <Text variant="caption" tone="text2">
              {t('offers.exit.plan')}
            </Text>
            <PriceLine
              testID="exit-offer-price"
              was={plan.price}
              offer={intro.price}
              suffix={t('offers.exit.firstYear')}
              label={t('offers.exit.priceA11y', { offer: intro.price, was: plan.price })}
            />
            <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.exit.renews', { price: plan.price })}
            </Text>
          </View>
          <Button
            testID="exit-offer-take"
            variant="premium"
            label={t('offers.exit.take', { percent })}
            loading={busy}
            onPress={onTake}
          />
          <Button
            testID="exit-offer-no"
            variant="ghost"
            label={t('offers.exit.noThanks')}
            onPress={onClose}
          />
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * D57 (2), iOS only: the one offer screen between Settings/Us → Manage subscription and the App
 * Store page. The `cancel30` promotional offer on the person's current product (prices and the
 * percentage from the store). "Continue to cancel" opens the store's subscription page at once, so
 * cancelling stays Manage subscription → Continue to cancel (P3's "Cancel anytime in 2 taps").
 */
export function CancelOfferSheet({
  visible,
  offer,
  busy = false,
  onTake,
  onContinue,
  onClose,
}: {
  visible: boolean;
  offer: CancelOffer | null;
  busy?: boolean;
  onTake: () => void;
  onContinue: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <Sheet visible={visible && offer !== null} onDismiss={onClose} testID="cancel-offer-sheet">
      {offer ? (
        <>
          <View style={{ alignItems: 'flex-end' }}>
            <CloseButton
              testID="cancel-offer-close"
              label={t('offers.cancel.close')}
              onPress={onClose}
            />
          </View>
          <View style={{ alignItems: 'center', gap: space.md }}>
            <Mascot mood="snuggled" size={56} />
            <Text
              variant="h2"
              accessibilityRole="header"
              style={{ textAlign: 'center' }}
              testID="cancel-offer-title"
            >
              {t('offers.cancel.title', { percent: offer.percent })}
            </Text>
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.cancel.body')}
            </Text>
            <PriceLine
              testID="cancel-offer-price"
              was={offer.regularPrice}
              offer={offer.offerPrice}
              suffix={t('offers.cancel.nextYear')}
              label={t('offers.cancel.priceA11y', {
                offer: offer.offerPrice,
                was: offer.regularPrice,
              })}
            />
            <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.cancel.note')}
            </Text>
          </View>
          <Button
            testID="cancel-offer-take"
            variant="premium"
            label={t('offers.cancel.take', { percent: offer.percent })}
            loading={busy}
            onPress={onTake}
          />
          <Button
            testID="cancel-offer-continue"
            variant="ghost"
            label={t('offers.cancel.continue')}
            onPress={onContinue}
          />
        </>
      ) : null}
    </Sheet>
  );
}
