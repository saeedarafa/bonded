import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActiveCouple } from '@/features/couple/hooks';
import { DailyError } from '@/features/daily/components/DailyFrame';
import { usePremium } from '@/features/premium/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import type { AppError } from '@/lib/errors';
import {
  Banner,
  Button,
  Chip,
  Icon,
  OfflineBanner,
  packToneColors,
  Skeleton,
  SkeletonGroup,
  Text,
  TopBar,
  useTheme,
} from '@/ui';

import type { PackDetail, PackQuestion } from '../api';
import { startFailure, usePack, useStartedPackQuestions, useStartPackQuestion } from '../hooks';
import { packPreview, packVisual } from '../model';

/** Board 33 shows three locked rows; the rest is a count. */
const LOCKED_ROWS_SHOWN = 3;
/** The board's bar widths for locked rows (placeholder text, never the real question). */
const BAR_WIDTHS = ['88%', '72%', '80%'] as const;

/**
 * 33 Pack preview (D51). A free couple sees "A question from this pack" as a sample to read (no
 * answer button), the questions it already started (they stay openable), and locked rows without
 * their text; "Unlock every pack" and every locked row open the paywall (34): no start for a free
 * couple ever reaches the server. A Premium couple sees every question. Opening a question goes
 * through `start_pack_question`: the server decides, and its `PREMIUM_REQUIRED` opens 34 instead.
 * Once started, the question opens in the answer flow (19, MOB-49).
 */
export default function PackPreviewScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { packId } = useLocalSearchParams<{ packId: string }>();
  const pack = usePack(packId);
  const premium = usePremium();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  const start = useStartPackQuestion();
  const [startError, setStartError] = useState<AppError | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const me = profiles.me?.display_name?.trim() || t('today.you');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/packs'));
  // Display only. Unknown (loading/error) counts as not premium: rows stay locked.
  const isPremium = premium.status === 'ready' && premium.isPremium;
  const started = useStartedPackQuestions(
    pack.data,
    premium.status === 'ready' && !premium.isPremium,
  );

  const toPaywall = (p: PackDetail) =>
    router.push({
      pathname: '/paywall',
      params: { from: 'pack', pack: p.title, packId: p.id },
    });

  const openQuestion = (p: PackDetail, q: PackQuestion) => {
    if (start.isPending) return;
    setStartError(null);
    setPendingId(q.id);
    start.mutate(q.id, {
      // MOB-49: straight to 19 for that row; if it's already answered, 19 hands over to 30.
      onSuccess: (coupleQuestionId) => router.push(`/history/${coupleQuestionId}/answer`),
      onError: (error) => {
        if (startFailure(error) === 'paywall') return toPaywall(p);
        setStartError(error);
        AccessibilityInfo.announceForAccessibility(error.message);
      },
      onSettled: () => setPendingId(null),
    });
  };

  let body;
  let chip = null;
  let footer = null;
  if (pack.error && pack.data === undefined) {
    body = (
      <DailyError
        testID="33-error"
        error={pack.error}
        fallback={t('packs.preview.loadError')}
        onRetry={() => void pack.refetch()}
      />
    );
  } else if (pack.data === undefined) {
    body = (
      <SkeletonGroup testID="33-loading">
        <Skeleton height={132} />
        <Skeleton height={32} width="60%" />
        <Skeleton height={48} />
        <Skeleton height={96} />
      </SkeletonGroup>
    );
  } else if (pack.data === null) {
    body = (
      <View testID="33-gone" style={{ gap: space.lg }}>
        <Text variant="h2" accessibilityRole="header">
          {t('packs.preview.gone')}
        </Text>
        <Button label={t('packs.preview.goneCta')} onPress={() => router.replace('/packs')} />
      </View>
    );
  } else {
    const p = pack.data;
    const v = packVisual(p.icon);
    const tile = packToneColors(colors, v.tone);
    const preview = packPreview(p, isPremium, started.data);
    const lockedRows = preview.mode === 'locked' ? preview.locked : [];
    const hiddenCount = Math.max(0, lockedRows.length - LOCKED_ROWS_SHOWN);
    chip = <Chip testID="33-premium-chip" label={t('packs.preview.premium')} tone="premium" />;

    const questionRow = (q: PackQuestion, onPress: () => void, testID: string) => (
      <Pressable
        key={q.id}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={q.body}
        accessibilityHint={t('packs.preview.openRowHint')}
        accessibilityState={{ busy: pendingId === q.id }}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
          opacity: pressed || pendingId === q.id ? 0.7 : 1,
        })}
      >
        <Text variant="label" style={{ flex: 1 }}>
          {q.body}
        </Text>
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Icon name="back" size={18} color={colors.text3} />
        </View>
      </Pressable>
    );

    body = (
      <View style={{ gap: space.lg - 2 }}>
        <View
          style={{
            height: 132,
            borderRadius: radius.card + 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tile.bg,
          }}
        >
          <Icon name={v.icon} size={56} strokeWidth={1.6} color={tile.fg} />
        </View>
        <View style={{ gap: space.xs + 2 }}>
          <Text variant="h1" accessibilityRole="header" testID="33-title">
            {p.title}
          </Text>
          {p.description ? <Text tone="text2">{p.description}</Text> : null}
        </View>

        {startError ? (
          <Banner testID="33-start-error" tone="error" message={startError.message} />
        ) : null}

        {p.questions.length === 0 ? (
          <Text tone="text2" testID="33-empty">
            {t('packs.preview.emptyPack')}
          </Text>
        ) : preview.mode === 'open' ? (
          <View style={{ gap: space.md - 2 }} testID="33-questions">
            {preview.questions.map((q) =>
              questionRow(q, () => openQuestion(p, q), `33-question-${q.position}`),
            )}
          </View>
        ) : (
          <>
            {preview.sample ? (
              <Card testID="33-sample">
                <Chip label={t('packs.preview.sample')} tone="you" />
                <Text variant="h2" testID="33-sample-question">
                  {preview.sample.body}
                </Text>
              </Card>
            ) : null}

            {preview.started.length > 0 ? (
              <View style={{ gap: space.md - 2 }} testID="33-started">
                <Text variant="label" tone="text2" accessibilityRole="header">
                  {t('packs.preview.started')}
                </Text>
                {preview.started.map(({ question, coupleQuestionId }) =>
                  questionRow(
                    question,
                    // Already the couple's: open it, no new start (MOB-49 routes by state).
                    () => router.push(`/history/${coupleQuestionId}/answer`),
                    `33-started-${question.position}`,
                  ),
                )}
              </View>
            ) : null}

            {lockedRows.length > 0 ? (
              <Card testID="33-locked">
                {lockedRows.slice(0, LOCKED_ROWS_SHOWN).map((row, i) => (
                  <Pressable
                    key={row.id}
                    testID={`33-locked-${row.position}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('packs.preview.lockedRow', { n: row.position })}
                    onPress={() => toPaywall(p)}
                    style={{
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md - 2,
                    }}
                  >
                    <View
                      style={{
                        flex: 1,
                        height: 12,
                        borderRadius: radius.pill,
                        backgroundColor: colors.surface2,
                      }}
                    >
                      <View
                        style={{
                          width: BAR_WIDTHS[i % BAR_WIDTHS.length],
                          height: 12,
                          borderRadius: radius.pill,
                          backgroundColor: colors.skeleton,
                        }}
                      />
                    </View>
                    <Icon name="lock" size={18} color={colors.premiumText} />
                  </Pressable>
                ))}
                {hiddenCount > 0 ? (
                  <Text variant="caption" tone="text3" testID="33-more">
                    {t('packs.preview.more', { count: hiddenCount })}
                  </Text>
                ) : null}
              </Card>
            ) : null}
          </>
        )}
      </View>
    );

    if (preview.mode === 'locked' && p.questions.length > 0) {
      footer = (
        <View style={{ gap: space.sm }}>
          <Button
            testID="33-unlock"
            variant="premium"
            label={t('packs.preview.unlock')}
            onPress={() => toPaywall(p)}
          />
          <Text variant="caption" tone="text3" style={{ textAlign: 'center' }} testID="33-covers">
            {t('packs.preview.covers', { me, partner })}
          </Text>
        </View>
      );
    } else if (premium.viaPartner) {
      footer = (
        <Text
          variant="caption"
          tone="text3"
          style={{ textAlign: 'center' }}
          testID="33-partner-plan"
        >
          {t('packs.preview.partnerPlan', { partner })}
        </Text>
      );
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="33-screen">
      <OfflineBanner />
      <TopBar
        testID="33-top"
        onBack={back}
        right={chip ? <View style={{ paddingRight: space.md }}>{chip}</View> : undefined}
      />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          padding: space.gutter,
          paddingTop: space.sm,
          paddingBottom: space.xl + space.xs,
        }}
      >
        {body}
        {footer}
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        gap: space.md - 2,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        alignItems: 'stretch',
      }}
    >
      {children}
    </View>
  );
}
