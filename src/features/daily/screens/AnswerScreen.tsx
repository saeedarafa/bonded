import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { DailyError, DailyFrame, DailyLoading } from '@/features/daily/components/DailyFrame';
import { useSaveAnswer } from '@/features/daily/hooks';
import { questionPaths, useTodayContext } from '@/features/daily/useTodayContext';
import { useTranslation } from '@/i18n';
import { useDrafts } from '@/lib/drafts';
import { messageFor } from '@/lib/errors';
import { useOutbox } from '@/lib/outbox';
import {
  AnswerField,
  Avatar,
  AvatarPair,
  Banner,
  Button,
  Chip,
  Icon,
  KeepInView,
  Mascot,
  personColors,
  Text,
  TITLE_MAX_FONT_SCALE,
  useTheme,
} from '@/ui';

/**
 * 19 Write your answer, and J7 (`?first=1`: the joiner's first question, the partner already
 * answered, so locking in opens their answer at once). The draft lives in the encrypted store
 * (src/lib/drafts.ts) and is deleted once the answer is saved. Nothing here reads answer text:
 * the partner banner comes from `answer_count` only.
 *
 * 55 Offline: locking in without a connection queues the answer on the phone (src/lib/outbox.ts)
 * with the time it was written; it sends itself when the connection returns (D17). A queued answer
 * is not "answered": no reveal until the server has it (the partner's answer stays locked).
 *
 * MOB-49: `/history/<questionId>/answer` answers any other `couple_questions` row (a started pack
 * question) with the same rules; its home is 30, which routes it by state (waiting, reveal, done).
 */
export default function AnswerScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { first, questionId } = useLocalSearchParams<{ first?: string; questionId?: string }>();
  const ctx = useTodayContext(questionId);
  const paths = questionPaths(questionId);
  const save = useSaveAnswer();
  const id = ctx.question.data?.id;
  const draft = useDrafts((s) => (id ? (s.drafts[id] ?? '') : ''));
  const setDraft = useDrafts((s) => s.setDraft);
  const markRevealed = useDrafts((s) => s.markRevealed);
  const queued = useOutbox((s) => (id ? s.answers[id] : undefined));
  const waiting = !!queued && queued.status !== 'failed';
  const [missing, setMissing] = useState<string | null>(null);

  const back = () => (router.canGoBack() ? router.back() : router.replace(paths.home));
  // J7 is the joiner's first daily question only.
  const isFirst = !questionId && first === '1' && ctx.partnerAnswered;
  const partner = ctx.partner;
  const pc = personColors(colors, false);

  const submit = () => {
    const body = draft.trim();
    if (!id || !ctx.userId) return;
    if (!body) {
      setMissing(t('daily.answer.empty'));
      return;
    }
    const partnerAnswered = ctx.partnerAnswered;
    save.mutate(
      { coupleQuestionId: id, userId: ctx.userId, body },
      {
        onSuccess: ({ queued: onPhone }) => {
          // 55: stay here; it sends itself when the connection returns.
          if (onPhone)
            return AccessibilityInfo.announceForAccessibility(t('daily.answer.offline.saved'));
          // Today: back to 23. A pack question: its 30 shows the waiting (locked) state.
          if (!partnerAnswered) return questionId ? router.replace(paths.home) : back();
          if (isFirst) {
            // J7: instant reveal, no hold.
            markRevealed(id);
            return router.replace(paths.revealed);
          }
          return router.replace(paths.reveal);
        },
      },
    );
  };

  const savedOnline = save.isSuccess && !save.data.queued;
  const error =
    save.error?.message ??
    (queued?.status === 'failed' ? messageFor(queued.errorKind ?? 'UNKNOWN') : null);

  let body;
  let footer = null;
  if (questionId && ctx.question.data && ctx.mine && !waiting && !save.isPending && !savedOnline) {
    // A pack question I've already answered (33 opens it again): 30 knows where it stands.
    return <Redirect href={paths.home} />;
  } else if (ctx.question.data && ctx.mine && !waiting && !save.isPending && !savedOnline) {
    // Already answered (e.g. opened again from a notification): nothing to write here.
    body = (
      <View style={{ alignItems: 'center', gap: space.lg }} testID="19-answered">
        <Mascot mood="waiting" size={120} partnerName={partner} />
        <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('daily.answer.done')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('daily.answer.doneBody', { partner })}
        </Text>
      </View>
    );
    footer = <Button label={t('daily.backToToday')} onPress={() => router.replace('/today')} />;
  } else if (ctx.question.data) {
    body = (
      <View style={{ gap: space.lg }}>
        {isFirst ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pc.tint,
            }}
            testID="J7-banner"
          >
            <Avatar name={partner} isMe={false} size="sm" />
            <Text style={{ flex: 1, color: pc.text }}>
              {t('daily.answer.first.partnerWaiting', { partner })}
            </Text>
          </View>
        ) : null}
        {isFirst ? <Chip label={t('daily.answer.first.chip')} /> : null}
        <Text variant="h2" accessibilityRole="header">
          {ctx.question.data.question}
        </Text>
        {/* #85: while typing, the counter and the privacy line stay above the pinned button too. */}
        <KeepInView style={{ gap: space.sm }} testID="19-keep-in-view">
          {isFirst ? null : (
            <Text variant="caption" tone="text2">
              {t('daily.answer.label')}
            </Text>
          )}
          <AnswerField
            testID="19-field"
            label={t('daily.answer.label')}
            placeholder={t('daily.answer.placeholder')}
            value={draft}
            onChangeText={(text) => {
              setDraft(ctx.question.data?.id ?? '', text);
              if (missing) setMissing(null);
            }}
            error={missing}
          />
          {waiting ? (
            <View style={{ gap: space.sm }} testID="55-queued">
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: space.sm,
                }}
              >
                <Chip
                  tone="status"
                  testID={`55-chip-${queued.status}`}
                  label={
                    queued.status === 'sending'
                      ? t('daily.answer.offline.sending')
                      : t('daily.answer.offline.waiting')
                  }
                />
                <Text variant="caption" tone="text2">
                  {t('daily.answer.offline.saved')}
                </Text>
              </View>
              <Text variant="caption" tone="text2" testID="55-streak-safe">
                {t('daily.answer.offline.streakSafe')}
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name="lock" size={16} color={colors.text2} />
              <Text variant="caption" tone="text2" style={{ flex: 1 }} testID="19-private">
                {t('daily.answer.private')}
              </Text>
            </View>
          )}
        </KeepInView>
        {ctx.partnerAnswered && !isFirst ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pc.tint,
            }}
            testID="19-partner-answered"
          >
            <Avatar name={partner} isMe={false} size="sm" />
            <Text style={{ flex: 1, color: pc.text }}>
              {t('daily.answer.partnerAnswered', { partner })}
            </Text>
          </View>
        ) : null}
        {error ? <Banner tone="error" message={error} testID="19-error" /> : null}
      </View>
    );
    footer = (
      <Button
        testID="19-submit"
        icon={isFirst ? undefined : 'lock'}
        label={isFirst ? t('daily.answer.first.submit', { partner }) : t('daily.answer.submit')}
        loading={save.isPending}
        onPress={submit}
      />
    );
  } else if (ctx.error) {
    body = (
      <DailyError
        error={ctx.error}
        fallback={t('daily.loadError')}
        onRetry={ctx.refetch}
        testID="19-load-error"
      />
    );
  } else {
    body = <DailyLoading testID="19-loading" />;
  }

  return (
    <DailyFrame
      testID={isFirst ? 'J7-screen' : '19-screen'}
      onBack={back}
      offlineMessage={t('daily.answer.offline.banner')}
      {...(isFirst
        ? {
            center: (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
                <AvatarPair meName={ctx.me} partnerName={partner} size="sm" />
                <Text
                  variant="label"
                  maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
                  style={{ flexShrink: 1 }}
                >
                  {t('today.couple', { me: ctx.me, partner })}
                </Text>
              </View>
            ),
          }
        : { title: questionId ? t('daily.answer.packTitle') : t('daily.answer.title') })}
      footer={footer}
    >
      {body}
    </DailyFrame>
  );
}
