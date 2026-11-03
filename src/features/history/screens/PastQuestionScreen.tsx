import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { DailyError } from '@/features/daily/components/DailyFrame';
import { useRevealedQuestion } from '@/features/daily/hooks';
import { localDateKey, togetherSince } from '@/features/daily/today';
import { useHistoryDetail, useLastMessage } from '@/features/history/hooks';
import { dayOfBond, shortDate } from '@/features/history/model';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { useCoupleRealtime } from '@/lib/useCoupleRealtime';
import {
  AnswerCard,
  Button,
  Chip,
  Icon,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  TopBar,
  useTheme,
} from '@/ui';

/**
 * 30 Past question (read-only): the question, the partner's answer then mine, and a thread preview.
 * The reveal rule holds here too: answer text (`useRevealedQuestion`) and the last message are only
 * requested once MY answer exists; RLS is the real guard. Route `/history/[questionId]`.
 */
export default function PastQuestionScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, space, radius } = useTheme();
  const { questionId } = useLocalSearchParams<{ questionId: string }>();
  const { userId } = useSession();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  useCoupleRealtime(couple.data?.id);
  const detail = useHistoryDetail(questionId);
  const d = detail.data;
  const mine = !!d && !!userId && d.answeredBy.includes(userId);
  const partnerAnswered = !!d && d.answerCount - (mine ? 1 : 0) >= 1;
  const revealed = useRevealedQuestion(questionId, { enabled: mine });
  const both = mine && partnerAnswered;
  const last = useLastMessage(questionId, { enabled: both && (d?.replies ?? 0) > 0 });

  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const meName = profiles.me?.display_name?.trim() || t('history.past.you');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/history'));
  const locale = i18n.language || 'en';

  let chip = null;
  if (d && couple.data) {
    const dateKey = d.assignedFor ?? localDateKey(new Date(d.createdAt), couple.data.timezone);
    const date = shortDate(dateKey, locale);
    const n = dayOfBond(togetherSince(couple.data), dateKey, couple.data.timezone);
    chip = (
      <Chip
        testID="30-chip"
        label={t('history.past.chip', { date, n })}
        accessibilityLabel={t('history.past.chipA11y', { date, n })}
      />
    );
  }

  const error = detail.error ?? couple.error ?? revealed.error;
  let body;
  if (error) {
    body = (
      <DailyError
        error={error}
        fallback={t('history.past.loadError')}
        onRetry={() => {
          void detail.refetch();
          void couple.refetch();
          if (mine) void revealed.refetch();
        }}
        testID="30-error"
      />
    );
  } else if (d === null) {
    body = (
      <View style={{ gap: space.lg }} testID="30-not-found">
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('history.past.notFound')}
        </Text>
        <Button label={t('ui.back')} onPress={back} />
      </View>
    );
  } else if (!d || (mine && !revealed.data)) {
    body = (
      <SkeletonGroup testID="30-loading">
        <Skeleton height={28} width="80%" />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </SkeletonGroup>
    );
  } else {
    const answers = revealed.data?.answers ?? [];
    const myAnswer = answers.find((a) => a.userId === userId);
    const theirs = answers.find((a) => a.userId !== userId);
    body = (
      <View style={{ gap: space.md }}>
        <Text variant="h2" accessibilityRole="header" testID="30-question">
          {d.question}
        </Text>
        {theirs ? (
          <AnswerCard testID="30-partner" name={partner} isMe={false} body={theirs.body} />
        ) : partnerAnswered ? (
          // Answered, but locked for me: I never answered this one (RLS hides it).
          <AnswerCard testID="30-partner-locked" name={partner} isMe={false} locked />
        ) : null}
        {myAnswer ? (
          <AnswerCard
            testID="30-mine"
            name={t('history.past.you')}
            avatarName={meName}
            isMe
            body={myAnswer.body}
          />
        ) : null}
        {!mine && partnerAnswered ? (
          <Text tone="text2" testID="30-answer-first">
            {t('history.past.answerFirst', { partner })}
          </Text>
        ) : null}
        {mine && !partnerAnswered ? (
          <Text tone="text2" testID="30-partner-missed">
            {t('history.past.partnerMissed', { partner })}
          </Text>
        ) : null}
        {both ? (
          <View
            testID="30-thread-card"
            accessible
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
            }}
          >
            <Icon name="chat" size={22} color={colors.youText} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                {d.replies > 0
                  ? t('history.past.replies', { count: d.replies })
                  : t('history.past.noReplies')}
              </Text>
              {last.data ? (
                <Text variant="caption" tone="text2" testID="30-last-message">
                  {t('history.past.lastMessage', {
                    name: last.data.userId === userId ? t('history.past.you') : partner,
                    body: last.data.body,
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="30-screen">
      <OfflineBanner />
      <TopBar testID="30-top" onBack={back} center={chip} />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          padding: space.gutter,
          paddingTop: space.sm,
        }}
      >
        {body}
        {both ? (
          <Button
            testID="30-open-thread"
            variant="ghost"
            label={t('history.past.openThread')}
            onPress={() => router.push(`/history/${questionId}/thread`)}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
