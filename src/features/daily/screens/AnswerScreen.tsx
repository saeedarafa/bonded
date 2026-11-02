import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { DailyError, DailyFrame, DailyLoading } from '@/features/daily/components/DailyFrame';
import { useSaveAnswer } from '@/features/daily/hooks';
import { useTodayContext } from '@/features/daily/useTodayContext';
import { useTranslation } from '@/i18n';
import { useDrafts } from '@/lib/drafts';
import {
  AnswerField,
  Avatar,
  AvatarPair,
  Banner,
  Button,
  Chip,
  Icon,
  Mascot,
  personColors,
  Text,
  useTheme,
} from '@/ui';

/**
 * 19 Write your answer, and J7 (`?first=1`: the joiner's first question, the partner already
 * answered, so locking in opens their answer at once). The draft lives in the encrypted store
 * (src/lib/drafts.ts) and is deleted once the answer is saved. Nothing here reads answer text:
 * the partner banner comes from `answer_count` only.
 */
export default function AnswerScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { first } = useLocalSearchParams<{ first?: string }>();
  const ctx = useTodayContext();
  const save = useSaveAnswer();
  const id = ctx.question.data?.id;
  const draft = useDrafts((s) => (id ? (s.drafts[id] ?? '') : ''));
  const setDraft = useDrafts((s) => s.setDraft);
  const markRevealed = useDrafts((s) => s.markRevealed);
  const [missing, setMissing] = useState<string | null>(null);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/today'));
  const isFirst = first === '1' && ctx.partnerAnswered;
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
        onSuccess: () => {
          if (!partnerAnswered) return back();
          if (isFirst) {
            // J7: instant reveal, no hold.
            markRevealed(id);
            return router.replace('/today/revealed');
          }
          return router.replace('/today/reveal');
        },
      },
    );
  };

  let body;
  let footer = null;
  if (ctx.question.data && ctx.mine && !save.isPending && !save.isSuccess) {
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
        <View style={{ gap: space.sm }}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="lock" size={16} color={colors.text2} />
            <Text variant="caption" tone="text2" style={{ flex: 1 }} testID="19-private">
              {t('daily.answer.private')}
            </Text>
          </View>
        </View>
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
        {save.error ? <Banner tone="error" message={save.error.message} testID="19-error" /> : null}
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
      {...(isFirst
        ? {
            center: (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
                <AvatarPair meName={ctx.me} partnerName={partner} size="sm" />
                <Text variant="label">{t('today.couple', { me: ctx.me, partner })}</Text>
              </View>
            ),
          }
        : { title: t('daily.answer.title') })}
      footer={footer}
    >
      {body}
    </DailyFrame>
  );
}
