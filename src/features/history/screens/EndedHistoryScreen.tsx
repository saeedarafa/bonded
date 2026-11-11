import { useRouter } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { DailyError } from '@/features/daily/components/DailyFrame';
import { EndedUntilNote } from '@/features/history/components/EndedUntilNote';
import { HistoryExportCard } from '@/features/history/components/HistoryExportCard';
import { PremiumLockTag, useOpenHistoryPaywall } from '@/features/history/components/HistoryLock';
import { localDateKey } from '@/features/daily/today';
import { endedRowsForMe, type EndedRow } from '@/features/history/ended';
import { useEndedHistory, useEndedHistoryList } from '@/features/history/endedHooks';
import { shortDate } from '@/features/history/model';
import { useTranslation } from '@/i18n';
import {
  Button,
  Icon,
  Mascot,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  TopBar,
  useTheme,
} from '@/ui';

/**
 * MOB-50 (D08, D09): my ended couple's History, read-only for 30 days after it ended. Reuses 29's
 * list row (no answer text here); each row opens the archived question. When the 30 days are over
 * (or there is no ended couple) the screen says so instead: the server has closed it anyway.
 * Route `/ended`. No board: GAPS 2026-11-10 / MOB-50.
 * MOB-71 (D55): without Premium of my own, days older than yesterday stay listed but locked (lock
 * and "Premium"); tapping one opens the paywall `from=history`.
 * MOB-70 (D08): a visible note with the real date the archive is deleted (`ended-note`).
 */
export default function EndedHistoryScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, space } = useTheme();
  const { userId } = useSession();
  const ended = useEndedHistory();
  const coupleId = ended.couple?.id;
  const list = useEndedHistoryList(coupleId);
  const openPaywall = useOpenHistoryPaywall();
  const locale = i18n.language || 'en';
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const rows = endedRowsForMe((list.data?.pages ?? []).flat(), userId);

  let content;
  if (ended.couple === null) {
    content = (
      <View testID="ended-closed" style={{ gap: space.lg, padding: space.gutter }}>
        <Text
          variant="h2"
          accessibilityRole="header"
          maxFontSizeMultiplier={2}
          style={{ textAlign: 'center' }}
          testID="ended-closed-title"
        >
          {t('history.ended.closedTitle')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('history.ended.closed')}
        </Text>
        <Button label={t('ui.back')} onPress={back} />
      </View>
    );
  } else if (list.error) {
    content = (
      <View style={{ padding: space.gutter }}>
        <DailyError
          error={list.error}
          fallback={t('history.ended.loadError')}
          onRetry={() => void list.refetch()}
          testID="ended-error"
        />
      </View>
    );
  } else if (ended.couple === undefined || list.data === undefined) {
    content = (
      <View style={{ padding: space.gutter }}>
        <SkeletonGroup testID="ended-loading">
          <Skeleton height={28} width="70%" />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </SkeletonGroup>
      </View>
    );
  } else {
    const intro = (
      <View style={{ gap: space.sm, paddingBottom: space.lg }}>
        <Text
          variant="h1"
          accessibilityRole="header"
          maxFontSizeMultiplier={2}
          testID="ended-title"
        >
          {t('history.ended.title', { partner: ended.partner })}
        </Text>
        <Text tone="text2" testID="ended-until">
          {t('history.ended.body')}
        </Text>
        {/* MOB-70 (D08): the real last day, visible above the answers. */}
        {ended.until ? <EndedUntilNote until={ended.until} testID="ended-note" /> : null}
        {rows.length > 0 ? (
          // MOB-27: the same PDF as 58's card, so it is still there after "Not now" (GAPS).
          <HistoryExportCard couple={ended.couple} testID="ended-download" />
        ) : null}
      </View>
    );
    content = (
      <FlatList
        testID="ended-list"
        data={rows}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={intro}
        ListEmptyComponent={
          <View testID="ended-empty" style={{ alignItems: 'center', gap: space.lg }}>
            <Mascot
              mood="saving-a-seat"
              size={120}
              accessibilityLabel={t('history.ended.emptyMascot')}
            />
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {t('history.ended.empty')}
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xl }}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        {...(list.isFetchingNextPage
          ? { ListFooterComponent: <Skeleton height={56} testID="ended-more" /> }
          : {})}
        renderItem={({ item }) => (
          <EndedListRow
            row={item}
            locale={locale}
            onPress={() => (item.locked ? openPaywall() : router.push(`/ended/${item.id}`))}
          />
        )}
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="ended-history-screen">
      <OfflineBanner />
      <TopBar testID="ended-top" onBack={back} />
      {content}
    </SafeAreaView>
  );
}

function EndedListRow({
  row,
  locale,
  onPress,
}: {
  row: EndedRow;
  locale: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors, space, size } = useTheme();
  const date = shortDate(row.assignedFor ?? localDateKey(new Date(row.createdAt), null), locale);
  return (
    <Pressable
      testID={`ended-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={
        row.locked
          ? t('history.lockedRowA11y', { date, question: row.question })
          : t('history.ended.rowA11y', {
              date,
              question: row.question,
              replies: row.replies,
            })
      }
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
      </View>
      {row.locked ? (
        <PremiumLockTag testID={`ended-row-${row.id}-locked`} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Icon name="chat" size={14} color={colors.text2} />
          <Text variant="caption" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>
            {row.replies}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
