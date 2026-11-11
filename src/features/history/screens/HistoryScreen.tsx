import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActiveCouple } from '@/features/couple/hooks';
import { DailyError } from '@/features/daily/components/DailyFrame';
import { localDateKey } from '@/features/daily/today';
import type { HistoryRow } from '@/features/history/api';
import { PremiumLockTag, useOpenHistoryPaywall } from '@/features/history/components/HistoryLock';
import { untilLabel } from '@/features/history/ended';
import { useEndedHistory } from '@/features/history/endedHooks';
import {
  useHistoryList,
  useHistoryMonth,
  useHistoryStart,
  useUnreadThreadCounts,
} from '@/features/history/hooks';
import {
  heatDays,
  isHistoryEmpty,
  monthCounts,
  monthOf,
  monthTitle,
  shiftMonth,
  shortDate,
  type MonthKey,
} from '@/features/history/model';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { useCoupleRealtime } from '@/lib/useCoupleRealtime';
import {
  Button,
  Chip,
  Heatmap,
  Icon,
  Mascot,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  TITLE_MAX_FONT_SCALE,
  useTheme,
} from '@/ui';

/** Monday-first narrow weekday letters for the locale (2024-01-01 was a Monday). */
function weekdayLetters(locale: string): string[] {
  const f = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

/**
 * 29 History: the month heatmap (both / one / missed, today pulses) and every answered question,
 * newest first. 53 when there is nothing to look back on yet. No answer text on this screen.
 * MOB-71 (D55): a day the server marks `locked` (free couple, older than yesterday) stays in the
 * list with its date and question, shows a lock and "Premium" instead of the counts, and opens
 * the paywall `from=history`.
 * MOB-73 (D56): a past daily day only one of us answered says "Only {name} answered" under the
 * question (no text; the day has ended, so there is no answer entry). Today's row doesn't (it's
 * still open), nor does a pack question (no day).
 */
export default function HistoryScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, space, radius, size } = useTheme();
  const couple = useActiveCouple();
  const coupleId = couple.data?.id;
  const tz = couple.data?.timezone;
  useCoupleRealtime(coupleId);

  const today = localDateKey(new Date(), tz);
  const thisMonth = monthOf(today);
  const [month, setMonth] = useState<MonthKey>(thisMonth);
  const start = useHistoryStart(coupleId);
  const days = useHistoryMonth(coupleId, month);
  const list = useHistoryList(coupleId);
  const unread = useUnreadThreadCounts(!!coupleId);
  const openPaywall = useOpenHistoryPaywall();
  const profiles = useCoupleProfiles();
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const locale = i18n.language || 'en';

  // `history_days` lists every day; the list shows the ones someone answered (the heatmap shows
  // the missed ones).
  const rows = (list.data?.pages ?? []).flat().filter((r) => r.answerCount > 0);
  const error = couple.error ?? start.error ?? days.error ?? list.error;
  const loading =
    !error && (couple.data === undefined || start.data === undefined || list.data === undefined);
  const firstMonth = start.data ? monthOf(start.data) : thisMonth;

  function retry() {
    void couple.refetch();
    void start.refetch();
    void days.refetch();
    void list.refetch();
  }

  const header = (
    <View
      testID="29-header"
      style={{
        flexDirection: 'row',
        // #107: at AX5 on an SE the month controls drop under the title instead of squeezing it.
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.md,
        paddingHorizontal: space.gutter,
        paddingVertical: space.md,
      }}
    >
      <Text
        testID="29-title"
        variant="h1"
        accessibilityRole="header"
        // #107: capped like the other screen titles (#84), so "History" never breaks mid-word.
        maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
      >
        {t('history.title')}
      </Text>
      {!loading && !error && !isHistoryEmpty(rows, today) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {month > firstMonth ? (
            <Pressable
              testID="29-month-prev"
              accessibilityRole="button"
              accessibilityLabel={t('history.prevMonth')}
              onPress={() => setMonth(shiftMonth(month, -1))}
              style={{
                width: size.tapTarget,
                height: size.tapTarget,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="back" size={18} color={colors.text2} />
            </Pressable>
          ) : null}
          <Chip testID="29-month" label={monthTitle(month, locale)} />
          {month < thisMonth ? (
            <Pressable
              testID="29-month-next"
              accessibilityRole="button"
              accessibilityLabel={t('history.nextMonth')}
              onPress={() => setMonth(shiftMonth(month, 1))}
              style={{
                width: size.tapTarget,
                height: size.tapTarget,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <Icon name="back" size={18} color={colors.text2} />
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  let content;
  if (error) {
    content = (
      <View style={{ padding: space.gutter }}>
        <DailyError
          error={error}
          fallback={t('history.loadError')}
          onRetry={retry}
          testID="29-error"
        />
      </View>
    );
  } else if (loading) {
    content = (
      <View style={{ padding: space.gutter }}>
        <SkeletonGroup testID="29-loading">
          <Skeleton height={300} />
          <Skeleton height={20} width="60%" />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </SkeletonGroup>
      </View>
    );
  } else if (isHistoryEmpty(rows, today)) {
    content = (
      <View
        testID="53-screen"
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.lg,
          padding: space.gutter,
        }}
      >
        <Mascot mood="saving-a-seat" size={150} accessibilityLabel={t('history.empty.mascot')} />
        <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('history.empty.title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('history.empty.body')}
        </Text>
        <Button
          testID="53-answer"
          label={t('history.empty.cta')}
          onPress={() => router.navigate('/today')}
        />
      </View>
    );
  } else {
    const cells = heatDays({ month, rows: days.data ?? [], firstDay: start.data ?? null, today });
    const counts = monthCounts(cells);
    const title = monthTitle(month, locale);
    const calendar = (
      <View style={{ gap: space.lg, paddingBottom: space.md }}>
        <View
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
          }}
        >
          <View
            style={{ flexDirection: 'row', gap: 6 }}
            importantForAccessibility="no-hide-descendants"
          >
            {weekdayLetters(locale).map((d, i) => (
              <Text
                key={i}
                variant="caption"
                tone="text2"
                allowFontScaling={false}
                style={{ flex: 1, textAlign: 'center' }}
              >
                {d}
              </Text>
            ))}
          </View>
          {days.data ? (
            <Heatmap
              testID="29-heatmap"
              days={cells}
              label={t('history.heatmapA11y', { month: title, ...counts })}
            />
          ) : (
            <Skeleton height={220} testID="29-heatmap-loading" />
          )}
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}
            importantForAccessibility="no-hide-descendants"
          >
            <Legend color={colors.you} label={t('history.legend.both')} />
            <Legend color={colors.youTint} label={t('history.legend.one')} />
            <Legend
              color={colors.surface}
              border={colors.line}
              label={t('history.legend.missed')}
            />
          </View>
        </View>
        <Text tone="text2" testID="29-together">
          <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
            {counts.both}
          </Text>{' '}
          {t('history.togetherThisMonth', { count: counts.both })}
        </Text>
      </View>
    );

    content = (
      <FlatList
        testID="29-list"
        data={rows}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={calendar}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xl }}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        {...(list.isFetchingNextPage
          ? { ListFooterComponent: <Skeleton height={56} testID="29-more" /> }
          : {})}
        renderItem={({ item }) => (
          <HistoryListRow
            row={item}
            only={onlyOneAnswered(item, today)}
            partner={partner}
            tz={tz}
            locale={locale}
            unread={item.locked ? 0 : (unread.data?.[item.id] ?? 0)}
            onPress={() => {
              if (item.locked) return openPaywall();
              // Today's question opens where Today would (answer, reveal or thread): /question/<id>.
              router.push(
                item.source === 'daily' && item.assignedFor === today
                  ? `/question/${item.id}`
                  : `/history/${item.id}`,
              );
            }}
          />
        )}
      />
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="29-screen"
    >
      <OfflineBanner />
      {header}
      <EndedEntry onPress={() => router.push('/ended')} />
      {content}
    </SafeAreaView>
  );
}

/**
 * MOB-50 (D08): the door to my ended couple's History while its 30 days last (42 and 58 promise
 * it). Not on board 29: GAPS 2026-11-10 / MOB-50. Hidden once the window has passed.
 */
function EndedEntry({ onPress }: { onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors, space, radius, size } = useTheme();
  const ended = useEndedHistory();
  if (!ended.couple || !ended.until) return null;
  const date = untilLabel(ended.until, i18n.language || 'en');
  return (
    <View style={{ paddingHorizontal: space.gutter, paddingBottom: space.md }}>
      <Pressable
        testID="29-ended"
        accessibilityRole="button"
        accessibilityLabel={t('history.ended.entryA11y', { partner: ended.partner, date })}
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: size.tapTarget,
          padding: space.lg,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface2,
        }}
      >
        <Icon name="history" size={20} color={colors.text2} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label">{t('history.ended.entry', { partner: ended.partner })}</Text>
          <Text variant="caption" tone="text2">
            {t('history.ended.entryBody', { date })}
          </Text>
        </View>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="back" size={16} color={colors.text3} />
        </View>
      </Pressable>
    </View>
  );
}

function Legend({ color, border, label }: { color: string; border?: string; label: string }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 4,
          backgroundColor: color,
          borderWidth: border ? 1 : 0,
          borderColor: border ?? 'transparent',
        }}
      />
      <Text variant="caption" tone="text2">
        {label}
      </Text>
    </View>
  );
}

/** D56: who alone answered a past daily day one of us missed ("Only Sam answered"), else null. */
export function onlyOneAnswered(row: HistoryRow, today: string): 'me' | 'partner' | null {
  if (row.source !== 'daily' || !row.assignedFor || row.assignedFor >= today) return null;
  if (row.answerCount !== 1 || row.myAnswered === undefined) return null;
  return row.myAnswered ? 'me' : 'partner';
}

function HistoryListRow({
  row,
  only: onlyWho,
  partner,
  tz,
  locale,
  unread,
  onPress,
}: {
  row: HistoryRow;
  /** D56: who alone answered a past daily day, or null. */
  only: 'me' | 'partner' | null;
  partner: string;
  tz: string | null | undefined;
  locale: string;
  unread: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors, space, size } = useTheme();
  const date = shortDate(row.assignedFor ?? localDateKey(new Date(row.createdAt), tz), locale);
  const only =
    onlyWho === 'me'
      ? t('history.onlyYou')
      : onlyWho === 'partner'
        ? t('history.onlyAnswered', { name: partner })
        : null;
  return (
    <Pressable
      testID={`29-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={
        (row.locked
          ? t('history.lockedRowA11y', { date, question: row.question })
          : t('history.rowA11y', {
              date,
              question: row.question,
              hearts: row.hearts,
              replies: row.replies,
            })) + (only ? ` ${only}.` : '')
      }
      {...(unread > 0 ? { accessibilityHint: t('history.unread', { count: unread }) } : {})}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: size.tapTarget,
        paddingVertical: space.md,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>
          {date}
        </Text>
        <Text>{row.question}</Text>
        {only ? (
          <Text variant="caption" tone="text2" testID={`29-row-${row.id}-only`}>
            {only}
          </Text>
        ) : null}
      </View>
      {row.locked ? (
        <PremiumLockTag testID={`29-row-${row.id}-locked`} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="heart" size={14} color={colors.text2} filled />
            <Text variant="caption" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>
              {row.hearts}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="chat" size={14} color={colors.text2} />
            <Text variant="caption" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>
              {row.replies}
            </Text>
            {unread > 0 ? (
              <View
                testID={`29-row-${row.id}-unread`}
                style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.you }}
              />
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  );
}
