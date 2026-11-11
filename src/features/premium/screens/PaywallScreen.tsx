import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { inviteDomain } from '@/lib/env';
import {
  AvatarPair,
  Banner,
  Button,
  Chip,
  Icon,
  Mascot,
  Skeleton,
  SkeletonGroup,
  Text,
  useTheme,
  useToast,
} from '@/ui';

import {
  ComparisonTable,
  ExitSheet,
  PaymentFailedSheet,
  PlanPicker,
} from '../components/PaywallParts';
import { packsBenefit } from '../features';
import {
  useConfirmPremium,
  useOffering,
  usePremium,
  usePurchase,
  useRestore,
  useTrialEligible,
} from '../hooks';
import type { OfferingId, PurchaseFailure } from '../purchases';

/** Inline notices; `payment` and `unknown` open the 57 sheet instead. */
type Notice = Exclude<PurchaseFailure, 'payment' | 'unknown'> | 'confirming' | null;

/** D52: 16 and 34 sell only the `default` offering (the retired `intro`/`winback` never load). */
const OFFERING: OfferingId = 'default';

/**
 * 16 Paywall (D52: the P3 layout without a trial) and 34 Paywall from a pack
 * (`?from=pack&pack=<title>&packId=<id>`, D53: 17's rows, no trial): the same component. 16 opens
 * only from a Premium touchpoint, never by itself (BIZ-16). Its × (and Android back) opens exit
 * sheet 17, whose trial button needs RevenueCat's eligibility. Plans, prices, the per-person
 * price and "save [X]%" come only from the RevenueCat offering (D31); premium is confirmed by the
 * server entitlement before 35 (D29). Without a RevenueCat key this is a safe "Not available
 * right now" screen.
 */
export default function PaywallScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const params = useLocalSearchParams<{ from?: string; pack?: string; packId?: string }>();
  const fromPack = params.from === 'pack';
  // D55 (MOB-71): a locked History day opens 16 headed "Unlock all your history with Premium".
  const fromHistory = params.from === 'history';
  const id = fromPack ? '34' : '16';

  const { me, partner } = useCoupleProfiles();
  const premium = usePremium();
  const offering = useOffering(OFFERING);
  const purchase = usePurchase();
  const restore = useRestore();
  const confirm = useConfirmPremium();
  const showToast = useToast((s) => s.show);

  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [exitOpen, setExitOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const plans = offering.data?.plans ?? [];
  const selectedId = chosen ?? plans[0]?.id;
  const selected = plans.find((p) => p.id === selectedId);
  // 17's trial: the yearly plan's store trial, only for a person RevenueCat says still gets it.
  const trialPlan = fromPack ? undefined : plans.find((p) => p.trial?.days);
  const trialEligible = useTrialEligible(trialPlan);
  const exitTrialDays = trialEligible ? (trialPlan?.trial?.days ?? null) : null;

  // Android back on 16 opens 17 like the × does (once per close); 34 just goes back.
  const exitOnBack = !fromPack && !exitOpen && !failedOpen && plans.length > 0;
  useEffect(() => {
    if (!exitOnBack) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setExitOpen(true);
      return true;
    });
    return () => sub.remove();
  }, [exitOnBack]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/today'));
  const toSuccess = () =>
    router.replace({
      pathname: '/success',
      params: fromPack && params.packId ? { pack: params.pack, packId: params.packId } : {},
    });

  const onFailure = (reason: PurchaseFailure) => {
    if (reason === 'payment' || reason === 'unknown') setFailedOpen(true);
    else setNotice(reason);
  };

  const buy = (plan = selected) => {
    if (!plan || purchase.isPending) return;
    setNotice(null);
    purchase.mutate(
      { offeringId: OFFERING, planId: plan.id },
      {
        onSuccess: ({ outcome, confirmed }) => {
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') return onFailure(outcome.reason);
          if (confirmed) toSuccess();
          else setNotice('confirming');
        },
      },
    );
  };

  const doRestore = () => {
    if (restore.isPending) return;
    setNotice(null);
    restore.mutate(undefined, {
      onSuccess: ({ outcome, confirmed }) => {
        if (confirmed) return toSuccess();
        if (outcome.kind === 'restored') {
          if (outcome.premiumHint) setNotice('confirming');
          else showToast(t('premium.errors.restoreNothing'), 'info');
          return;
        }
        if (outcome.reason === 'network' || outcome.reason === 'unavailable') {
          setNotice(outcome.reason);
        } else {
          showToast(t('premium.errors.restoreFailed'), 'error');
        }
      },
    });
  };

  const checkAgain = () =>
    confirm.mutate(undefined, { onSuccess: (ok) => (ok ? toSuccess() : undefined) });

  const meName = me?.display_name.trim() || t('pairing.partnerFallback');
  const partnerName = partner?.display_name.trim() || null;

  // Not available: no key on this build, or no offering in RevenueCat.
  if (!offering.available || (offering.isSuccess && plans.length === 0)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={`${id}-screen`}>
        <View
          testID={`${id}-unavailable`}
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            gap: space.lg,
            padding: space.gutter,
          }}
        >
          <Mascot mood="napping" size={120} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('premium.unavailable.title')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('premium.unavailable.body')}
          </Text>
          <Button
            testID={`${id}-back`}
            variant="ghost"
            label={t('premium.unavailable.back')}
            onPress={leave}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Already covered (mine or my partner's): nothing to sell.
  if (premium.isPremium) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={`${id}-screen`}>
        <View
          testID={`${id}-premium`}
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            gap: space.lg,
            padding: space.gutter,
          }}
        >
          <Chip tone="premium" label={t('premium.chip')} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('premium.alreadyPremium')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {premium.viaPartner && partnerName
              ? t('premium.alreadyPremiumPartner', { partner: partnerName })
              : t('premium.alreadyPremiumMine')}
          </Text>
          <Button testID={`${id}-done`} label={t('premium.done')} onPress={leave} />
        </View>
      </SafeAreaView>
    );
  }

  const domain = inviteDomain();
  const busy = purchase.isPending || notice === 'confirming';
  const partnerLabel = partnerName ?? t('pairing.partnerFallback');
  const benefits = [
    t('premium.benefits.psychology'),
    t(`premium.benefits.${packsBenefit()}`),
    partnerName
      ? t('premium.benefits.partner', { partner: partnerName })
      : t('premium.benefits.partnerSolo'),
  ];

  const closeButton = (
    <Pressable
      testID={`${id}-close`}
      accessibilityRole="button"
      accessibilityLabel={fromPack ? t('premium.close') : t('premium.closeFree')}
      hitSlop={12}
      onPress={() => (fromPack ? leave() : setExitOpen(true))}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="close" color={colors.text2} />
    </Pressable>
  );
  const restoreButton = (
    <Button
      testID={`${id}-restore`}
      variant="link"
      label={t('premium.restore')}
      loading={restore.isPending}
      onPress={doRestore}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={`${id}-screen`}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: space.lg,
        }}
      >
        {/* 16: × left, the pair, Restore right (board S03). 34: Restore left, × right (S07). */}
        {fromPack ? restoreButton : closeButton}
        {fromPack ? null : <AvatarPair meName={meName} partnerName={partnerLabel} size="sm" />}
        {fromPack ? closeButton : restoreButton}
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
          {fromPack ? <Chip tone="premium" label={t('premium.chip')} /> : null}
          <Text variant="h1" accessibilityRole="header" testID={`${id}-title`}>
            {fromPack
              ? params.pack
                ? t('premium.fromPackTitle', { pack: params.pack })
                : t('premium.fromPackTitleGeneric')
              : fromHistory
                ? t('premium.titleHistory')
                : partnerName
                  ? t('premium.title16', { partner: partnerName })
                  : t('premium.title16Solo')}
          </Text>
          {fromPack ? null : (
            <View
              testID="16-benefits"
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
          )}
        </View>

        {fromPack ? <ComparisonTable id="34" /> : null}

        {offering.isError ? (
          <View style={{ gap: space.md }}>
            <Banner tone="error" message={t('premium.offeringError')} testID={`${id}-error`} />
            <Button
              testID={`${id}-retry`}
              variant="ghost"
              label={t('premium.retry')}
              onPress={() => void offering.refetch()}
            />
          </View>
        ) : offering.isPending ? (
          <SkeletonGroup testID={`${id}-loading`}>
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
            layout={id}
            plans={plans}
            selected={selectedId}
            onSelect={(planId) => {
              setChosen(planId);
              setNotice(null);
            }}
          />
        )}

        {!fromPack && selected ? (
          <View
            testID="16-assurance"
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              columnGap: space.lg,
              rowGap: space.xs,
            }}
          >
            {[
              partnerName
                ? t('premium.partnerIncluded', { partner: partnerName })
                : t('premium.partnerIncludedSolo'),
              t('premium.cancelTwoTaps'),
            ].map((line) => (
              <View
                key={line}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
              >
                <Icon name="check" size={14} strokeWidth={3} color={colors.youText} />
                <Text variant="label" tone="text2">
                  {line}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ flex: 1 }} />

        {notice ? (
          <View style={{ gap: space.sm }}>
            <Banner
              tone="error"
              testID={`${id}-notice-${notice}`}
              message={
                notice === 'confirming' ? t('premium.confirming') : t(`premium.errors.${notice}`)
              }
            />
            {notice === 'confirming' ? (
              <Button
                testID={`${id}-check-again`}
                variant="ghost"
                label={t('premium.checkAgain')}
                loading={confirm.isPending}
                onPress={checkAgain}
              />
            ) : notice === 'alreadyOwned' ? (
              <Button
                testID={`${id}-notice-restore`}
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
              testID={`${id}-buy`}
              variant="premium"
              label={t('premium.ctaBoth')}
              loading={busy}
              onPress={() => buy()}
            />
            {fromPack ? (
              <Text variant="caption" tone="text3" style={{ textAlign: 'center' }}>
                {t('premium.coversBoth')}
              </Text>
            ) : (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  alignItems: 'center',
                  columnGap: space.sm,
                }}
              >
                <Text variant="caption" tone="text3" testID="16-billing">
                  {selected.kind === 'yearly'
                    ? t('premium.billedYearly')
                    : t('premium.billedMonthly')}
                </Text>
                {domain ? (
                  <>
                    <LegalLink label={t('premium.terms')} url={`https://${domain}/terms`} />
                    <LegalLink label={t('premium.privacy')} url={`https://${domain}/privacy`} />
                  </>
                ) : null}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

      <ExitSheet
        visible={exitOpen}
        trialDays={exitTrialDays}
        busy={busy}
        onTrial={() => {
          setExitOpen(false);
          if (trialPlan) {
            setChosen(trialPlan.id);
            buy(trialPlan);
          }
        }}
        onStay={() => setExitOpen(false)}
        onLeave={() => {
          setExitOpen(false);
          leave();
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

function LegalLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
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
