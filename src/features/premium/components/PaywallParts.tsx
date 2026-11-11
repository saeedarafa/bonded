import { Linking, Platform, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Button, Chip, Icon, Mascot, PlanCard, Sheet, Text, useTheme } from '@/ui';

import { compareRows, type CompareKey, type CompareRow } from '../features';
import { perPersonMonthly, savePercent } from '../pricing';
import { manageSubscriptionsUrl, type Plan } from '../purchases';

/**
 * Plan cards for 16 (P3 layout without a trial, D52) and 34 (from a pack, D53). Every price comes
 * from the offering; the per-person price and "save [X]%" are computed from the store's numbers
 * (`pricing.ts`) and dropped when the store gave none. No trial copy on either screen.
 */
export function PlanPicker({
  plans,
  selected,
  onSelect,
  layout,
}: {
  plans: Plan[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  layout: '16' | '34';
}) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const yearlyPlan = plans.find((p) => p.kind === 'yearly');
  const monthlyPlan = plans.find((p) => p.kind === 'monthly');
  const save = savePercent(yearlyPlan, monthlyPlan);
  const perPerson = perPersonMonthly(yearlyPlan);

  const cardProps = (plan: Plan) => {
    const yearly = plan.kind === 'yearly';
    const best = yearly && plans.length > 1;
    if (layout === '16') {
      if (yearly) {
        return {
          title: t('premium.yearly'),
          price: perPerson ?? plan.price,
          detail: perPerson ? t('premium.perPersonMonth') : t('premium.perYearPlain'),
          caption: perPerson ? t('premium.yearForBoth', { price: plan.price }) : undefined,
          badge: best
            ? save !== null
              ? t('premium.bestValueSave', { percent: save })
              : t('premium.bestValue')
            : undefined,
        };
      }
      return {
        title: t('premium.monthly'),
        price: plan.price,
        detail: t('premium.perMonthPlain'),
        caption: t('premium.flexible'),
      };
    }
    if (yearly) {
      return {
        title: t('premium.yearly'),
        price: t('premium.perYr', { price: plan.price }),
        detail: save !== null && monthlyPlan ? t('premium.save', { percent: save }) : undefined,
        badge: best ? t('premium.bestValue') : undefined,
      };
    }
    return {
      title: t('premium.monthly'),
      price: t('premium.perMo', { price: plan.price }),
      detail: t('premium.flexibleShort'),
    };
  };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('premium.plansLabel')}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.sm }}
    >
      {plans.map((plan) => (
        <View key={plan.id} style={{ flexGrow: 1, flexBasis: 140 }}>
          <PlanCard
            testID={`${layout}-plan-${plan.kind}`}
            {...cardProps(plan)}
            selected={selected === plan.id}
            onPress={() => onSelect(plan.id)}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * Free vs Premium (17 and 34, D51/D53). Rows come from the one feature list (`features.ts`): only
 * features in this build, in D51's order (D27, REL-BIZ-03). Test ids: `<id>-compare`,
 * `<id>-row-<feature>`.
 */
export function ComparisonTable({ id, rows = compareRows() }: { id: string; rows?: CompareRow[] }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const cell = { width: 84, textAlign: 'center' as const };
  const shown = (key: CompareKey) => t(`premium.compare.${key}`);
  const spoken = (key: CompareKey) => (key === 'none' ? t('premium.compare.no') : shown(key));
  return (
    <View
      testID={`${id}-compare`}
      accessibilityLabel={t('premium.compare.label')}
      style={{
        borderRadius: radius.input,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <View
        style={{ flexDirection: 'row' }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <View style={{ flex: 1 }} />
        <Text variant="caption" tone="text2" style={cell}>
          {t('premium.compare.free')}
        </Text>
        <Text variant="caption" tone="premiumText" style={cell}>
          {t('premium.compare.premium')}
        </Text>
      </View>
      {rows.map((row) => (
        <View
          key={row.id}
          testID={`${id}-row-${row.id}`}
          accessible
          accessibilityLabel={t('premium.compare.row', {
            feature: shown(row.feature),
            free: spoken(row.free),
            premium: spoken(row.premium),
          })}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Text style={{ flex: 1 }}>{shown(row.feature)}</Text>
          <Text tone="text2" style={cell}>
            {shown(row.free)}
          </Text>
          <Text variant="label" style={cell}>
            {shown(row.premium)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 17: closing 16 (D51, D52). The main button reads "Try Premium free for N days" (N from the store)
 * only while RevenueCat says this person is trial-eligible, and then buys the yearly plan with its
 * trial; otherwise "Get Premium", back to 16's plans. Never opens another paywall.
 */
export function ExitSheet({
  visible,
  trialDays,
  busy,
  onTrial,
  onStay,
  onLeave,
}: {
  visible: boolean;
  /** The eligible trial length in days, or null (not eligible, unknown, or no trial). */
  trialDays: number | null;
  busy?: boolean;
  onTrial: () => void;
  onStay: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const trial = trialDays !== null;
  return (
    <Sheet visible={visible} onDismiss={onStay} testID="17-sheet">
      <View style={{ alignItems: 'center', gap: space.md }}>
        <Mascot mood="snuggled" size={56} />
        <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('premium.exit.title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }} testID="17-subtitle">
          {t('premium.exit.body')}
        </Text>
      </View>
      <ComparisonTable id="17" />
      <Button
        testID="17-main"
        variant="premium"
        label={
          trial ? t('premium.exit.tryDays', { count: trialDays }) : t('premium.exit.getPremium')
        }
        loading={trial && busy}
        onPress={trial ? onTrial : onStay}
      />
      <Button
        testID="17-leave"
        variant="ghost"
        label={t('premium.exit.continueFree')}
        onPress={onLeave}
      />
    </Sheet>
  );
}

/** 57: the store refused the payment. "Nothing was charged." */
export function PaymentFailedSheet({
  visible,
  onRetry,
  onDismiss,
}: {
  visible: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  return (
    <Sheet visible={visible} onDismiss={onDismiss} testID="57-sheet">
      <View style={{ alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.blushTint,
          }}
        >
          <Icon name="cardError" color={colors.blushText} size={28} />
        </View>
        <Text
          variant="h2"
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          style={{ textAlign: 'center' }}
        >
          {t('premium.failed.title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t(Platform.OS === 'android' ? 'premium.failed.bodyAndroid' : 'premium.failed.bodyIos')}
        </Text>
      </View>
      <Button testID="57-retry" label={t('premium.failed.retry')} onPress={onRetry} />
      <Button
        testID="57-manage"
        variant="ghost"
        label={t('premium.failed.manage')}
        onPress={() => void Linking.openURL(manageSubscriptionsUrl(Platform.OS)).catch(() => {})}
      />
    </Sheet>
  );
}

/** J8 / 13: "Premium · on Maya's plan". Only when the partner's plan covers me (D29). */
export function PartnerPlanNote({ partner, testID }: { partner: string; testID: string }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        alignItems: 'center',
        gap: space.sm,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.premium,
        backgroundColor: colors.premiumTint,
      }}
    >
      <Chip tone="premium" label={t('premium.partnerPlan.chip', { partner })} />
      <Text tone="text2" style={{ textAlign: 'center' }}>
        {t('premium.partnerPlan.body', { partner })}
      </Text>
    </View>
  );
}
