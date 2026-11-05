import { Linking, Platform, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Button, Chip, Icon, Mascot, PlanCard, Sheet, Text, useTheme } from '@/ui';

import { manageSubscriptionsUrl, type Plan, type Trial } from '../purchases';

type T = ReturnType<typeof useTranslation>['t'];

/** "7 days free" from the store's intro period (never a hard-coded length, D31). */
export function trialLabel(t: T, trial: Trial): string {
  if (trial.days !== null) return t('premium.trialDays', { count: trial.days });
  if (trial.unit === 'month') return t('premium.trialMonths', { count: trial.count });
  return t('premium.trialYears', { count: trial.count });
}

/** The gold button's label for the selected plan. */
export function ctaLabel(t: T, plan: Plan | undefined): string {
  if (!plan?.trial) return t('premium.ctaSubscribe');
  if (plan.trial.days !== null) return t('premium.ctaTrialDays', { count: plan.trial.days });
  return t('premium.ctaTrial');
}

/** Yearly then monthly, as radio cards. Every price string comes from the offering. */
export function PlanPicker({
  plans,
  selected,
  onSelect,
  testID,
}: {
  plans: Plan[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('premium.plansLabel')}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.sm }}
    >
      {plans.map((plan) => {
        const yearly = plan.kind === 'yearly';
        return (
          <View key={plan.id} style={{ flexGrow: 1, flexBasis: 140 }}>
            <PlanCard
              testID={`${testID}-plan-${plan.kind}`}
              title={t(yearly ? 'premium.yearly' : 'premium.monthly')}
              price={t(yearly ? 'premium.perYear' : 'premium.perMonth', { price: plan.price })}
              detail={
                yearly
                  ? plan.pricePerMonth
                    ? t('premium.perMonthBilledYearly', { price: plan.pricePerMonth })
                    : undefined
                  : t('premium.flexible')
              }
              caption={plan.trial ? trialLabel(t, plan.trial) : t('premium.noTrial')}
              badge={yearly && plans.length > 1 ? t('premium.bestValue') : undefined}
              selected={selected === plan.id}
              onPress={() => onSelect(plan.id)}
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * Today → billing day, for a free trial measured in days. Board 16's middle step ("Day 5: we
 * remind you before it ends") is left out: no trial-reminder push exists yet (GAPS).
 */
export function TrialSteps({ days, testID }: { days: number; testID: string }) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const steps = [
    {
      icon: 'lock' as const,
      bg: colors.premium,
      fg: colors.onPremium,
      title: t('premium.steps.today'),
      body: t('premium.steps.todayBody'),
    },
    {
      icon: 'card' as const,
      bg: colors.surface2,
      fg: colors.text2,
      title: t('premium.steps.day', { count: days }),
      body: t('premium.steps.dayBody'),
    },
  ];
  return (
    <View testID={testID} accessibilityLabel={t('premium.steps.label')} style={{ gap: space.md }}>
      {steps.map((s) => (
        <View
          key={s.title}
          accessible
          style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: s.bg,
            }}
          >
            <Icon name={s.icon} color={s.fg} size={14} strokeWidth={2.5} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="label">{s.title}</Text>
            <Text variant="caption" tone="text2">
              {s.body}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Free vs Premium. Rows match shipped features only (D27, REL-BIZ-03): board 34's "Couple report
 * · Later" row is left out because the report isn't in the launch build.
 */
export function ComparisonTable({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const rows: [string, string, string][] = [
    [t('premium.compare.daily'), t('premium.compare.yes'), t('premium.compare.yes')],
    [t('premium.compare.packs'), t('premium.compare.preview'), t('premium.compare.all')],
    [t('premium.compare.saver'), t('premium.compare.no'), t('premium.compare.yes')],
    [t('premium.compare.recap'), t('premium.compare.basic'), t('premium.compare.full')],
  ];
  const cell = { width: 72, textAlign: 'center' as const };
  return (
    <View
      testID={testID}
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
      {rows.map(([feature, free, premium]) => (
        <View
          key={feature}
          accessible
          accessibilityLabel={t('premium.compare.row', { feature, free, premium })}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Text style={{ flex: 1 }}>{feature}</Text>
          <Text tone="text3" style={cell}>
            {free}
          </Text>
          <Text variant="label" style={cell}>
            {premium}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 17: closing the paywall. Promises the daily question stays free. */
export function ExitSheet({
  visible,
  trialDays,
  onStay,
  onLeave,
}: {
  visible: boolean;
  trialDays: number | null;
  onStay: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <Sheet visible={visible} onDismiss={onStay} testID="17-sheet">
      <View style={{ alignItems: 'center', gap: space.md }}>
        <Mascot mood="snuggled" size={96} />
        <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('premium.exit.title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('premium.exit.body')}
        </Text>
      </View>
      <ComparisonTable testID="17-compare" />
      <Button
        testID="17-stay"
        variant="premium"
        label={
          trialDays !== null
            ? t('premium.exit.tryDays', { count: trialDays })
            : t('premium.exit.seePlans')
        }
        onPress={onStay}
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
