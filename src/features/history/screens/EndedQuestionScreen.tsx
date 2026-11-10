import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { DailyError } from '@/features/daily/components/DailyFrame';
import { useRevealedQuestion } from '@/features/daily/hooks';
import { localDateKey } from '@/features/daily/today';
import { endedAnswerState } from '@/features/history/ended';
import { useEndedHistory, useEndedQuestion } from '@/features/history/endedHooks';
import { shortDate } from '@/features/history/model';
import { useThread } from '@/features/thread/hooks';
import { useTranslation } from '@/i18n';
import {
  AnswerCard,
  Button,
  ChatBubble,
  Chip,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  TopBar,
  useTheme,
} from '@/ui';

/**
 * MOB-50 (D08, D09): one question of my ended couple, read-only (30 reused, no thread composer:
 * the archive is never writable). The reveal rule holds: answer text is requested only once MY
 * answer exists, my partner's card and the replies show only when we both answered; RLS is the
 * real guard. Route `/ended/[questionId]`.
 */
export default function EndedQuestionScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, space } = useTheme();
  const { questionId } = useLocalSearchParams<{ questionId: string }>();
  const { userId } = useSession();
  const ended = useEndedHistory();
  const coupleId = ended.couple?.id;
  const detail = useEndedQuestion(coupleId, questionId);
  const d = detail.data;
  const { mine, both } = endedAnswerState(d?.answeredBy ?? [], userId);
  const revealed = useRevealedQuestion(questionId, { enabled: !!d && mine });
  const thread = useThread(questionId, { enabled: both && (d?.replies ?? 0) > 0 });
  const back = () => (router.canGoBack() ? router.back() : router.replace('/ended'));
  const locale = i18n.language || 'en';
  const partner = ended.partner;

  const error = detail.error ?? revealed.error;
  let body;
  if (ended.couple === null) {
    body = (
      <View style={{ gap: space.lg }} testID="ended-q-closed">
        <Text
          variant="h2"
          accessibilityRole="header"
          maxFontSizeMultiplier={2}
          style={{ textAlign: 'center' }}
          testID="ended-q-closed-title"
        >
          {t('history.ended.closedTitle')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('history.ended.closed')}
        </Text>
        <Button label={t('ui.back')} onPress={back} />
      </View>
    );
  } else if (error) {
    body = (
      <DailyError
        error={error}
        fallback={t('history.past.loadError')}
        onRetry={() => {
          void detail.refetch();
          if (mine) void revealed.refetch();
        }}
        testID="ended-q-error"
      />
    );
  } else if (d === null) {
    body = (
      <View style={{ gap: space.lg }} testID="ended-q-not-found">
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('history.past.notFound')}
        </Text>
        <Button label={t('ui.back')} onPress={back} />
      </View>
    );
  } else if (!d || (mine && !revealed.data)) {
    body = (
      <SkeletonGroup testID="ended-q-loading">
        <Skeleton height={28} width="80%" />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </SkeletonGroup>
    );
  } else {
    const answers = revealed.data?.answers ?? [];
    const myAnswer = answers.find((a) => a.userId === userId);
    // Only when we both answered: RLS shows nothing else, and the screen never asks for more.
    const theirs = both ? answers.find((a) => a.userId !== userId) : undefined;
    body = (
      <View style={{ gap: space.md }}>
        <Text variant="h2" accessibilityRole="header" testID="ended-q-question">
          {d.question}
        </Text>
        {theirs ? (
          <AnswerCard testID="ended-q-partner" name={partner} isMe={false} body={theirs.body} />
        ) : null}
        {myAnswer ? (
          <AnswerCard
            testID="ended-q-mine"
            name={t('history.past.you')}
            isMe
            body={myAnswer.body}
          />
        ) : null}
        {!mine ? (
          <Text tone="text2" testID="ended-q-unanswered">
            {t('history.ended.unanswered')}
          </Text>
        ) : !theirs ? (
          <Text tone="text2" testID="ended-q-only-mine">
            {t('history.ended.onlyMine')}
          </Text>
        ) : null}
        {theirs && d.replies > 0 ? (
          <View style={{ gap: space.sm }} testID="ended-q-thread">
            <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
              {t('history.past.replies', { count: d.replies })}
            </Text>
            {(thread.data ?? []).map((m) => (
              <ChatBubble
                key={m.id}
                isMe={m.userId === userId}
                text={m.body}
                senderName={m.userId === userId ? t('history.past.you') : partner}
              />
            ))}
          </View>
        ) : null}
        <Text variant="caption" tone="text3" testID="ended-q-read-only">
          {t('history.ended.readOnly')}
        </Text>
      </View>
    );
  }

  const chip = d ? (
    <Chip
      testID="ended-q-chip"
      label={shortDate(d.assignedFor ?? localDateKey(new Date(d.createdAt), null), locale)}
    />
  ) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="ended-question-screen">
      <OfflineBanner />
      <TopBar testID="ended-q-top" onBack={back} center={chip} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: space.xl,
          padding: space.gutter,
          paddingTop: space.sm,
        }}
      >
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
