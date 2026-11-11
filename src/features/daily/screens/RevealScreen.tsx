import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { hoursSinceBothAnswered, useQuestionRef } from '@/features/daily/analytics';
import { DailyError, DailyFrame, DailyLoading } from '@/features/daily/components/DailyFrame';
import { questionPaths } from '@/features/daily/questionPaths';
import { useTodayContext } from '@/features/daily/useTodayContext';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { useDrafts } from '@/lib/drafts';
import {
  Avatar,
  Button,
  Chip,
  HoldToReveal,
  Icon,
  Mascot,
  personColors,
  Text,
  TITLE_MAX_FONT_SCALE,
  useCramped,
  useReducedMotion,
  useTheme,
} from '@/ui';

/**
 * 20 Hold to reveal. UI only (D13): this screen never reads answer text, not even once both have
 * answered. The sealed card is drawn from ids; the text is fetched by 21 after the hold.
 * Haptics (DESIGN.md §6) come from HoldToReveal: selection ticks while the ring fills, success
 * when it opens. Reduced motion: tap, then a confirming tap. Screen readers: an activate action.
 * MOB-49: `/history/<questionId>/reveal` does the same for a pack question.
 */
export default function RevealScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const reduced = useReducedMotion();
  // #86: short screen at large text: the sealed card stacks its name under avatar + chip.
  const cramped = useCramped();
  const { questionId } = useLocalSearchParams<{ questionId?: string }>();
  const ctx = useTodayContext(questionId);
  const paths = questionPaths(questionId);
  const markRevealed = useDrafts((s) => s.markRevealed);
  // Analytics (MOB-24c, §3.5): `reveal_started` once per visit, `answer_revealed` on completion.
  const questionRef = useQuestionRef(ctx.question.data);
  const revealStarted = useRef(false);
  const partner = ctx.partner;
  const back = () => (router.canGoBack() ? router.back() : router.replace(paths.home));

  let body;
  let footer = null;
  if (ctx.question.data && ctx.mine && ctx.partnerAnswered) {
    const id = ctx.question.data.id;
    body = (
      <View style={{ gap: space.xl }}>
        <View style={{ alignItems: 'center', gap: space.md }}>
          <Mascot mood="together" size={110} partnerName={partner} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('daily.reveal.title', { partner })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('daily.reveal.body')}
          </Text>
        </View>
        <View
          accessible
          accessibilityLabel={t('daily.reveal.sealedA11y', { partner })}
          testID="20-sealed"
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
          }}
        >
          <SealedHeader partner={partner} cramped={cramped} />
          {/* Placeholder bars, not text: there is nothing to blur because nothing was fetched. */}
          {['92%', '80%', '58%'].map((width) => (
            <View
              key={width}
              style={{
                width: width as `${number}%`,
                height: space.sm + 2,
                borderRadius: radius.pill,
                backgroundColor: colors.line,
              }}
            />
          ))}
        </View>
      </View>
    );
    // #33: pinned under the scrolling body so the hold ring never sits behind the tab bar.
    footer = (
      <View style={{ alignItems: 'center', gap: space.md }}>
        <HoldToReveal
          testID="20-hold"
          size={140}
          {...(reduced ? {} : { label: t('daily.reveal.holdA11y', { partner }) })}
          onStart={() => {
            if (revealStarted.current || !questionRef) return;
            revealStarted.current = true;
            track('reveal_started', { question_id: questionRef.question_id });
          }}
          onComplete={() => {
            if (questionRef) {
              track('answer_revealed', {
                ...questionRef,
                hours_since_both_answered: hoursSinceBothAnswered(ctx.question.data?.answers ?? []),
              });
            }
            markRevealed(id);
            AccessibilityInfo.announceForAccessibility(t('daily.reveal.announce', { partner }));
            router.replace(paths.revealed);
          }}
        />
        {reduced ? null : (
          <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
            {t('daily.reveal.hint')}
          </Text>
        )}
      </View>
    );
  } else if (ctx.question.data) {
    // Opened too early (a stale link or notification): say what's missing.
    const answerFirst = !ctx.mine;
    body = (
      <View style={{ alignItems: 'center', gap: space.lg }} testID="20-not-ready">
        <Mascot mood="waiting" size={120} partnerName={partner} />
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {answerFirst
            ? t('daily.reveal.answerFirst', { partner })
            : t('daily.reveal.notYet', { partner })}
        </Text>
        <Button
          testID="20-not-ready-cta"
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
  } else if (ctx.error) {
    body = (
      <DailyError
        error={ctx.error}
        fallback={t('daily.loadError')}
        onRetry={ctx.refetch}
        testID="20-load-error"
      />
    );
  } else {
    body = <DailyLoading testID="20-loading" />;
  }

  return (
    <DailyFrame testID="20-screen" onBack={back} footer={footer}>
      {body}
    </DailyFrame>
  );
}

/**
 * The sealed card's top row. #86: at AX5 the "Locked" chip left the name a sliver and it broke
 * letter by letter; cramped, the name gets its own full-width line under avatar + chip, and it
 * stops growing at 200% so a long first name still breaks between words only.
 */
function SealedHeader({ partner, cramped }: { partner: string; cramped: boolean }) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const pc = personColors(colors, false);
  const name = (
    <Text
      variant="label"
      maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
      style={cramped ? { color: pc.text } : { flex: 1, color: pc.text }}
      testID="20-sealed-name"
    >
      {partner}
    </Text>
  );
  const chip = (
    <Chip
      tone="partner"
      label={t('daily.reveal.locked')}
      leading={<Icon name="lock" size={14} color={pc.text} />}
    />
  );
  if (!cramped)
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Avatar name={partner} isMe={false} size="sm" />
        {name}
        {chip}
      </View>
    );
  return (
    <View style={{ gap: space.sm }} testID="20-sealed-stacked">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.sm,
        }}
      >
        <Avatar name={partner} isMe={false} size="sm" />
        {chip}
      </View>
      {name}
    </View>
  );
}
