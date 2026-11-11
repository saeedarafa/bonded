import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';

import { DailyError, DailyFrame, DailyLoading } from '@/features/daily/components/DailyFrame';
import { useSaveAnswer } from '@/features/daily/hooks';
import { questionPaths } from '@/features/daily/questionPaths';
import { useTodayContext } from '@/features/daily/useTodayContext';
import { SHIPPED } from '@/features/premium/features';
import { usePremium } from '@/features/premium/hooks';
import { AnswerTypeSwitch, type AnswerMode } from '@/features/voice/components/AnswerTypeSwitch';
import { VoicePane } from '@/features/voice/components/VoicePane';
import type { VoiceTake } from '@/features/voice/useVoiceRecorder';
import { useTranslation } from '@/i18n';
import { useDrafts } from '@/lib/drafts';
import {
  ANSWER_MAX_FREE,
  ANSWER_MAX_PREMIUM,
  ANSWER_TOO_LONG,
  messageFor,
  type AppErrorKind,
} from '@/lib/errors';
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
/** 19d (D46): from about 450 characters a free couple sees "N left. Premium: 2000". */
export const ANSWER_UPSELL_FROM = 450;

/**
 * D46 / BE-41: the input cap follows the couple's Premium state on the server (500 free, 2000
 * Premium). The database decides at write time; a lapse between typing and sending comes back as
 * ANSWER_TOO_LONG with the limit that applied.
 */
export function answerMaxLength(isPremium: boolean): number {
  return isPremium ? ANSWER_MAX_PREMIUM : ANSWER_MAX_FREE;
}

/** Server answers that mean "the Premium state I showed was stale": re-read it (D46). */
const RECHECK_PREMIUM: readonly AppErrorKind[] = [
  ANSWER_TOO_LONG,
  'PREMIUM_REQUIRED',
  'VOICE_DENIED',
];

export default function AnswerScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { first, questionId } = useLocalSearchParams<{ first?: string; questionId?: string }>();
  const ctx = useTodayContext(questionId);
  const paths = questionPaths(questionId);
  const save = useSaveAnswer();
  const premium = usePremium();
  const maxLength = answerMaxLength(premium.isPremium);
  const id = ctx.question.data?.id;
  const draft = useDrafts((s) => (id ? (s.drafts[id] ?? '') : ''));
  const setDraft = useDrafts((s) => s.setDraft);
  const markRevealed = useDrafts((s) => s.markRevealed);
  const queued = useOutbox((s) => (id ? s.answers[id] : undefined));
  const waiting = !!queued && queued.status !== 'failed';
  const [missing, setMissing] = useState<string | null>(null);
  // D46: Write | Voice. Only in builds that ship voice (D27); free couples see "Premium" on Voice.
  const [mode, setMode] = useState<AnswerMode>('write');
  const [take, setTake] = useState<VoiceTake | null>(null);
  const [voiceMissing, setVoiceMissing] = useState(false);
  const voiceLocked = premium.status !== 'ready' || !premium.isPremium;
  const showVoice = SHIPPED.voice && !voiceLocked;
  const voiceMode = showVoice && mode === 'voice';

  const back = () => (router.canGoBack() ? router.back() : router.replace(paths.home));
  // J7 is the joiner's first daily question only.
  const isFirst = !questionId && first === '1' && ctx.partnerAnswered;
  const partner = ctx.partner;
  const pc = personColors(colors, false);
  const left = maxLength - draft.length;
  // 19d: only for a couple the server says is free; plain 19 carries no offer (D46).
  const upsell =
    !voiceMode &&
    premium.status === 'ready' &&
    !premium.isPremium &&
    draft.length >= ANSWER_UPSELL_FROM &&
    left >= 0;

  const submit = () => {
    const body = draft.trim();
    if (!id || !ctx.userId) return;
    if (voiceMode && !take) {
      setVoiceMissing(true);
      return;
    }
    if (!voiceMode && !body) {
      setMissing(t('daily.answer.empty'));
      return;
    }
    const partnerAnswered = ctx.partnerAnswered;
    save.mutate(
      voiceMode && take
        ? { coupleQuestionId: id, userId: ctx.userId, body: '', voice: { ...take } }
        : { coupleQuestionId: id, userId: ctx.userId, body },
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
        // The limit changed under us (a lapse, or a purchase not seen yet): re-read Premium so the
        // cap and the counter match what the server applied.
        onError: (e) => {
          if (RECHECK_PREMIUM.includes(e.kind)) void premium.refetch();
        },
      },
    );
  };

  const savedOnline = save.isSuccess && !save.data.queued;
  const error =
    save.error?.message ??
    (queued?.status === 'failed'
      ? messageFor(queued.errorKind ?? 'UNKNOWN', { max: queued.errorMax })
      : null);

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
        {SHIPPED.voice && premium.status === 'ready' ? (
          <AnswerTypeSwitch
            mode={voiceMode ? 'voice' : 'write'}
            onChange={(next) => {
              setMode(next);
              setVoiceMissing(false);
            }}
            voiceLocked={voiceLocked}
            onLockedVoice={() => router.push({ pathname: '/paywall', params: { from: 'voice' } })}
          />
        ) : null}
        {showVoice ? (
          <VoicePane
            coupleId={ctx.couple.data?.id}
            userId={ctx.userId}
            visible={voiceMode}
            onTake={setTake}
          />
        ) : null}
        {voiceMode && voiceMissing && !take ? (
          <Text variant="caption" style={{ color: colors.blushText }} testID="19c-missing">
            {t('voice.answer.empty')}
          </Text>
        ) : null}
        {/* #85: while typing, the counter and the privacy line stay above the pinned button too. */}
        <KeepInView style={{ gap: space.sm }} testID="19-keep-in-view">
          {voiceMode ? null : (
            <>
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
                maxLength={maxLength}
                onChangeText={(text) => {
                  setDraft(ctx.question.data?.id ?? '', text);
                  if (missing) setMissing(null);
                }}
                error={missing}
              />
            </>
          )}
          {upsell ? (
            <Pressable
              testID="19d-upsell"
              accessibilityRole="button"
              accessibilityLabel={t('daily.answer.limit.a11y', {
                count: left,
                max: ANSWER_MAX_PREMIUM,
              })}
              onPress={() => router.push({ pathname: '/paywall', params: { from: 'answer' } })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space.sm,
                minHeight: 44,
                paddingHorizontal: space.md,
                borderRadius: radius.input,
                borderWidth: 1,
                borderColor: colors.premium,
                backgroundColor: colors.premiumTint,
              }}
            >
              <Text variant="label" style={{ flex: 1 }}>
                {t('daily.answer.limit.left', { count: left })}{' '}
                <Text variant="label" style={{ color: colors.premiumText }}>
                  {t('daily.answer.limit.premium', { max: ANSWER_MAX_PREMIUM })}
                </Text>
              </Text>
              <Icon name="chevron" size={16} color={colors.premiumText} />
            </Pressable>
          ) : null}
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
