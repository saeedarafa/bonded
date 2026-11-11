import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import {
  ExitSheet,
  PaymentFailedSheet,
  PlanPicker,
} from '@/features/premium/components/PaywallParts';
import { packsBenefit } from '@/features/premium/features';
import {
  useOffering,
  useSignedOutPurchase,
  useSignedOutRestore,
  useTrialEligible,
} from '@/features/premium/hooks';
import { trialReminderDay, zeroPrice } from '@/features/premium/pricing';
import type { OfferingId, Plan, PurchaseFailure } from '@/features/premium/purchases';
import { useTranslation } from '@/i18n';
import { inviteDomain } from '@/lib/env';
import {
  AvatarPair,
  Banner,
  Button,
  Icon,
  type IconName,
  Skeleton,
  SkeletonGroup,
  Text,
  useTheme,
  useToast,
} from '@/ui';

import { AFTER_PLAN } from '../flow';
import { markOnboardingDone } from '../resume';
import { useOnboarding } from '../store';

/** D50/D52: P3 sells the `default` offering (yearly with the store's 7-day trial, monthly without). */
const OFFERING: OfferingId = 'default';

type Notice = Exclude<PurchaseFailure, 'payment' | 'unknown'> | null;

/**
 * P3 soft trial paywall (D50, board S01), after P2 "Start our plan" and before sign-in. Only the
 * person who starts the couple sees it: a joiner holding an invite is sent on (D29).
 *
 * - × (and Android back) opens exit sheet 17 **once**; "Continue with free" (or × again) goes to
 *   sign-in on the free plan. 17 never opens another paywall, and 16 is never shown after P3.
 * - Yearly is pre-selected: "Best value · save [X]%", the price per person per month and the
 *   yearly total for both; monthly "No free trial". Every price, the save % and the trial length
 *   come from the RevenueCat offering; "$0" is zero in the store's currency. Trial copy (timeline,
 *   "Try N days free") only while RevenueCat says this person still gets the trial (BIZ-10).
 * - The purchase happens signed out, under RevenueCat's anonymous id; sign-in runs `logIn(uid)` →
 *   `revenuecat-sync` (`pendingPurchase.ts`), and premium shows only from the server entitlement.
 * - Without a RevenueCat key or an offering there is nothing to sell: P3 steps aside to sign-in.
 */
export function TrialPaywallScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status } = useSession();
  const showToast = useToast((s) => s.show);
  const joining = usePendingInvite((s) => s.code !== null);
  const me = useOnboarding((s) => s.displayName).trim();
  const partner = useOnboarding((s) => s.partnerName).trim();

  const offering = useOffering(OFFERING);
  const purchase = useSignedOutPurchase();
  const restore = useSignedOutRestore();

  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitShown, setExitShown] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const plans = offering.data?.plans ?? [];
  const yearly = plans.find((p) => p.kind === 'yearly');
  const selectedId = chosen ?? yearly?.id ?? plans[0]?.id;
  const selected = plans.find((p) => p.id === selectedId);
  const trialEligible = useTrialEligible(yearly);
  const trialDays = trialEligible ? (yearly?.trial?.days ?? null) : null;
  const trialSelected = selected !== undefined && selected === yearly && trialDays !== null;

  const next = status === 'signedIn' ? '/' : AFTER_PLAN;
  const goOn = () => {
    markOnboardingDone();
    router.replace(next);
  };

  // Nothing to sell (no key, no offering) or a joiner: straight on to sign-in.
  const skip = joining || !offering.available || (offering.isSuccess && plans.length === 0);
  useEffect(() => {
    if (!skip) return;
    markOnboardingDone();
    router.replace(next);
  }, [skip, router, next]);

  const close = () => {
    if (exitShown || plans.length === 0) return goOn();
    setExitShown(true);
    setExitOpen(true);
  };

  const blocking = exitOpen || failedOpen;
  useEffect(() => {
    if (blocking) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  });

  const onFailure = (reason: PurchaseFailure) => {
    if (reason === 'payment' || reason === 'unknown') setFailedOpen(true);
    else setNotice(reason);
  };

  const buy = (plan: Plan | undefined = selected) => {
    if (!plan || purchase.isPending) return;
    setNotice(null);
    purchase.mutate(
      { offeringId: OFFERING, planId: plan.id },
      {
        onSuccess: ({ outcome }) => {
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') return onFailure(outcome.reason);
          if (status !== 'signedIn') showToast(t('onboarding.trial.started'), 'success');
          goOn();
        },
      },
    );
  };

  const doRestore = () => {
    if (restore.isPending) return;
    setNotice(null);
    restore.mutate(undefined, {
      onSuccess: ({ outcome }) => {
        if (outcome.kind === 'restored') {
          if (!outcome.premiumHint) return showToast(t('premium.errors.restoreNothing'), 'info');
          if (status !== 'signedIn') showToast(t('onboarding.trial.restored'), 'success');
          return goOn();
        }
        if (outcome.reason === 'network' || outcome.reason === 'unavailable') {
          setNotice(outcome.reason);
        } else {
          showToast(t('premium.errors.restoreFailed'), 'error');
        }
      },
    });
  };

  if (skip) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} />;

  const domain = inviteDomain();
  const partnerLabel = partner || t('pairing.partnerFallback');
  const benefits = [
    t('premium.benefits.psychology'),
    t(`premium.benefits.${packsBenefit()}`),
    partner ? t('premium.benefits.partner', { partner }) : t('premium.benefits.partnerSolo'),
  ];
  const zero = zeroPrice(yearly);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="P3-screen">
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: space.lg,
        }}
      >
        <Pressable
          testID="P3-close"
          accessibilityRole="button"
          accessibilityLabel={t('premium.closeFree')}
          hitSlop={12}
          onPress={close}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" color={colors.text2} />
        </Pressable>
        <AvatarPair
          meName={me || t('onboarding.meFallback')}
          partnerName={partnerLabel}
          size="sm"
        />
        <Button
          testID="P3-restore"
          variant="link"
          label={t('premium.restore')}
          loading={restore.isPending}
          onPress={doRestore}
        />
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: space.xl,
          paddingHorizontal: space.gutter,
          paddingBottom: space.xl,
        }}
      >
        <View style={{ gap: space.lg }}>
          <Text variant="h1" accessibilityRole="header" testID="P3-title">
            {partner ? t('premium.title16', { partner }) : t('premium.title16Solo')}
          </Text>
          <View
            testID="P3-benefits"
            accessibilityLabel={t('premium.benefits.label')}
            style={{ gap: space.sm + 2 }}
          >
            {benefits.map((b) => (
              <View
                key={b}
                accessible
                style={{ flexDirection: 'row', gap: space.sm + 2, alignItems: 'flex-start' }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.you,
                  }}
                >
                  <Icon name="check" size={13} strokeWidth={3} color={colors.onYou} />
                </View>
                <Text style={{ flex: 1 }}>{b}</Text>
              </View>
            ))}
          </View>
        </View>

        {offering.isError ? (
          <View style={{ gap: space.md }}>
            <Banner tone="error" message={t('premium.offeringError')} testID="P3-error" />
            <Button
              testID="P3-retry"
              variant="ghost"
              label={t('premium.retry')}
              onPress={() => void offering.refetch()}
            />
            <Button
              testID="P3-free"
              variant="link"
              label={t('premium.exit.continueFree')}
              onPress={goOn}
            />
          </View>
        ) : offering.isPending ? (
          <SkeletonGroup testID="P3-loading">
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Skeleton height={120} />
              </View>
              <View style={{ flex: 1 }}>
                <Skeleton height={120} />
              </View>
            </View>
          </SkeletonGroup>
        ) : (
          <PlanPicker
            layout="P3"
            plans={plans}
            selected={selectedId}
            trialOnYearly={trialDays !== null}
            onSelect={(planId) => {
              setChosen(planId);
              setNotice(null);
            }}
          />
        )}

        {trialSelected && trialDays !== null ? (
          <TrialTimeline days={trialDays} zero={zero} />
        ) : null}

        <View style={{ flex: 1 }} />

        {notice ? (
          <View style={{ gap: space.sm }}>
            <Banner
              tone="error"
              testID={`P3-notice-${notice}`}
              message={t(`premium.errors.${notice}`)}
            />
            {notice === 'alreadyOwned' ? (
              <Button
                testID="P3-notice-restore"
                variant="ghost"
                label={t('premium.restore')}
                loading={restore.isPending}
                onPress={doRestore}
              />
            ) : null}
          </View>
        ) : null}

        {selected ? (
          <View style={{ gap: space.sm }}>
            <Button
              testID="P3-buy"
              variant="premium"
              label={
                trialSelected
                  ? t('onboarding.trial.cta', { count: trialDays })
                  : t('premium.ctaBoth')
              }
              loading={purchase.isPending}
              onPress={() => buy()}
            />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                columnGap: space.sm,
              }}
            >
              <Text
                variant="caption"
                tone="text3"
                testID="P3-billing"
                style={{ textAlign: 'center' }}
              >
                {trialSelected
                  ? zero
                    ? t('onboarding.trial.zeroToday', { zero })
                    : t('onboarding.trial.zeroTodayPlain')
                  : selected.kind === 'yearly'
                    ? t('premium.billedYearly')
                    : t('premium.billedMonthly')}
              </Text>
              {domain ? (
                <>
                  <LegalLink
                    testID="P3-terms"
                    label={t('premium.terms')}
                    url={`https://${domain}/terms`}
                  />
                  <LegalLink
                    testID="P3-privacy"
                    label={t('premium.privacy')}
                    url={`https://${domain}/privacy`}
                  />
                </>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <ExitSheet
        visible={exitOpen}
        trialDays={trialDays}
        busy={purchase.isPending}
        onTrial={() => {
          setExitOpen(false);
          if (yearly) {
            setChosen(yearly.id);
            buy(yearly);
          }
        }}
        onStay={() => setExitOpen(false)}
        onLeave={() => {
          setExitOpen(false);
          goOn();
        }}
      />
      <PaymentFailedSheet
        visible={failedOpen}
        onDismiss={() => setFailedOpen(false)}
        onRetry={() => {
          setFailedOpen(false);
          buy();
        }}
      />
    </SafeAreaView>
  );
}

/**
 * Today / Day 5 / Day 7 (board P3): the trial's steps, with the days from the store's trial length
 * and the reminder day the server uses for `trial_ending` (`trialReminderDay`). Read as one list.
 */
function TrialTimeline({ days, zero }: { days: number; zero: string | null }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const reminder = trialReminderDay(days);
  const steps: {
    key: string;
    icon: IconName;
    fill: string;
    ink: string;
    title: string;
    body: string;
  }[] = [
    {
      key: 'today',
      icon: 'lock',
      fill: colors.premium,
      ink: colors.onPremium,
      title: t('onboarding.trial.today'),
      body: zero ? t('onboarding.trial.todayBody', { zero }) : t('onboarding.trial.todayBodyPlain'),
    },
    ...(reminder !== null
      ? [
          {
            key: 'reminder',
            icon: 'bell' as const,
            fill: colors.youTint,
            ink: colors.youText,
            title: t('onboarding.trial.day', { day: reminder }),
            body: t('onboarding.trial.reminderBody'),
          },
        ]
      : []),
    {
      key: 'end',
      icon: 'check',
      fill: colors.surface2,
      ink: colors.text2,
      title: t('onboarding.trial.day', { day: days }),
      body: t('onboarding.trial.endBody'),
    },
  ];
  return (
    <View
      testID="P3-timeline"
      accessibilityLabel={t('onboarding.trial.timelineLabel')}
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
      }}
    >
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <View
            key={step.key}
            testID={`P3-timeline-${step.key}`}
            accessible
            accessibilityLabel={`${step.title}. ${step.body}`}
            style={{ flexDirection: 'row', gap: space.md }}
          >
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: step.fill,
                }}
              >
                <Icon name={step.icon} size={15} color={step.ink} />
              </View>
              {last ? null : (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    minHeight: space.sm,
                    marginTop: 3,
                    borderRadius: 1,
                    backgroundColor: colors.line,
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : space.sm }}>
              <Text variant="label">{step.title}</Text>
              <Text variant="caption" tone="text2">
                {step.body}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function LegalLink({ label, url, testID }: { label: string; url: string; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={12}
      style={{ minHeight: 44, justifyContent: 'center' }}
      onPress={() => void Linking.openURL(url).catch(() => {})}
    >
      <Text variant="caption" tone="text2" style={{ textDecorationLine: 'underline' }}>
        {label}
      </Text>
    </Pressable>
  );
}
