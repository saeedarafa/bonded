import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { DailyError, DailyFrame, DailyLoading } from '@/features/daily/components/DailyFrame';
import { useAnswerReaction, useRevealedQuestion, useStreak } from '@/features/daily/hooks';
import { questionPaths } from '@/features/daily/questionPaths';
import { useTodayContext } from '@/features/daily/useTodayContext';
import { useReviewOnClose } from '@/features/review/review';
import { VoiceNote } from '@/features/voice/components/VoiceNote';
import { useTranslation } from '@/i18n';
import { useCoupleRealtime } from '@/lib/useCoupleRealtime';
import {
  AnswerCard,
  Button,
  Chip,
  emojiName,
  isHeart,
  Mascot,
  normalizeReaction,
  personColors,
  ReactionRow,
  Text,
  useTheme,
  useToast,
} from '@/ui';

function clockTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/**
 * 21 Revealed + reactions. The reveal rule, end to end: the answer-text query runs only once my
 * own answer exists (`enabled`), and RLS decides what comes back: the partner's answer is absent
 * until I've answered, so it is never fetched, cached or shown before that.
 * D46 (MOB-55): a voice answer plays from a 60 s signed URL made at the tap; free couples can
 * listen. The bucket follows the same reveal rule, so a locked voice answer can't even be signed.
 * MOB-49: `/history/<questionId>/revealed` shows a pack question the same way (no streak chip:
 * pack questions don't count for the streak).
 */
export default function RevealedScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { questionId } = useLocalSearchParams<{ questionId?: string }>();
  const ctx = useTodayContext(questionId);
  const paths = questionPaths(questionId);
  const id = ctx.question.data?.id;
  const revealed = useRevealedQuestion(id, { enabled: !!ctx.mine });
  const streak = useStreak({ enabled: !!ctx.couple.data && !questionId });
  const react = useAnswerReaction(id ?? '');
  useCoupleRealtime(ctx.couple.data?.id);
  const partner = ctx.partner;
  const back = () => (router.canGoBack() ? router.back() : router.replace(paths.home));

  const mineFull = revealed.data?.answers.find((a) => a.userId === ctx.userId);
  const theirs = revealed.data?.answers.find((a) => a.userId !== ctx.userId);
  // D62: a reveal that was seen is a happy moment; the OS review sheet may follow its close.
  useReviewOnClose('reveal', !!(revealed.data && mineFull && theirs));

  const loadError = ctx.error ?? revealed.error;
  const notReady =
    !!ctx.question.data && (!ctx.mine || !ctx.partnerAnswered || (!!revealed.data && !theirs));

  let body;
  let footer = null;
  if (revealed.data && mineFull && theirs && ctx.userId) {
    const userId = ctx.userId;
    const theirKind = mineFull.reactions.find((r) => r.userId !== userId)?.kind;
    const theirReaction = theirKind ? normalizeReaction(theirKind) : null;
    const pc = personColors(colors, false);
    body = (
      <View style={{ gap: space.lg }}>
        <Text variant="h2" accessibilityRole="header">
          {revealed.data.question}
        </Text>
        <AnswerCard
          testID="21-partner"
          name={partner}
          isMe={false}
          time={clockTime(theirs.createdAt)}
          body={theirs.body}
          media={
            theirs.voice ? (
              <VoiceNote
                testID="21-partner-voice"
                source={{ path: theirs.voice.path }}
                durationMs={theirs.voice.durationMs}
                isMe={false}
              />
            ) : undefined
          }
        >
          <ReactionRow
            testID="21-react"
            reactions={theirs.reactions}
            userId={userId}
            onChange={(kind) =>
              react.mutate(
                { answerId: theirs.id, userId, kind },
                { onError: (e) => useToast.getState().show(e.message, 'error') },
              )
            }
          />
        </AnswerCard>
        <AnswerCard
          testID="21-mine"
          name={t('today.you')}
          avatarName={ctx.me}
          isMe
          time={clockTime(mineFull.createdAt)}
          body={mineFull.body}
          media={
            mineFull.voice ? (
              <VoiceNote
                testID="21-mine-voice"
                source={{ path: mineFull.voice.path }}
                durationMs={mineFull.voice.durationMs}
                isMe
              />
            ) : undefined
          }
        >
          {theirReaction ? (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
              testID="21-their-reaction"
              accessible
              accessibilityLabel={t('daily.revealed.reactedByA11y', {
                partner,
                name: emojiName(theirReaction),
              })}
            >
              <Text variant="label">{theirReaction}</Text>
              <Text variant="caption" style={{ flex: 1, color: pc.text }}>
                {isHeart(theirReaction)
                  ? t('daily.revealed.lovedBy', { partner })
                  : t('daily.revealed.reactedBy', { partner })}
              </Text>
            </View>
          ) : null}
        </AnswerCard>
      </View>
    );
    footer = (
      <Button
        testID="21-talk"
        label={t('daily.revealed.talk')}
        onPress={() => router.push(paths.thread)}
      />
    );
  } else if (notReady) {
    // Not both answered yet: nothing to reveal, and no answer text was requested.
    const answerFirst = !ctx.mine;
    body = (
      <View style={{ alignItems: 'center', gap: space.lg }} testID="21-not-ready">
        <Mascot mood="waiting" size={120} partnerName={partner} />
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {answerFirst
            ? t('daily.reveal.answerFirst', { partner })
            : t('daily.reveal.notYet', { partner })}
        </Text>
        <Button
          label={
            answerFirst
              ? t('daily.reveal.answerCta')
              : questionId
                ? t('ui.back')
                : t('daily.backToToday')
          }
          onPress={() => router.replace(answerFirst ? paths.answer : paths.home)}
        />
      </View>
    );
  } else if (loadError) {
    body = (
      <DailyError
        error={loadError}
        fallback={t('daily.revealed.loadError')}
        onRetry={() => {
          ctx.refetch();
          void revealed.refetch();
        }}
        testID="21-load-error"
      />
    );
  } else {
    body = <DailyLoading testID="21-loading" />;
  }

  const current = streak.data?.current ?? 0;
  return (
    <DailyFrame
      testID="21-screen"
      onBack={back}
      {...(!questionId && streak.data && streak.data.completedToday
        ? {
            right: (
              <Chip
                testID="21-streak"
                tone="streak"
                label={t('daily.revealed.streak', { n: current })}
                accessibilityLabel={t('daily.revealed.streakA11y', { n: current })}
                leading={<Mascot mood="together" size={24} />}
              />
            ),
          }
        : {})}
      footer={footer}
    >
      {body}
    </DailyFrame>
  );
}
