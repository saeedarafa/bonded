import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { QUIZ_STEP, storyVariant, type OnboardingStep } from '@/features/onboarding/flow';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { PageDots } from '@/features/onboarding/PageDots';
import { LAST_LEARNED, useOnboarding } from '@/features/onboarding/store';
import { useStepNav } from '@/features/onboarding/useStepNav';
import { capitalize, useTranslation } from '@/i18n';
import {
  AnswerCard,
  Button,
  ChatBubble,
  Icon,
  Mascot,
  OptionRow,
  ReactionPill,
  Text,
  useReducedMotion,
  useTheme,
} from '@/ui';

const STORY_PAGES = 3;
const BUBBLE_DELAY_MS = 450;

const BUBBLE_KEYS = ['b1', 'b2', 'b3', 'b4', 'b5'] as const;
/** 04's example reactions (board S01): ❤️ 1 picked, 😂, 🥹. A local toy; nothing is sent. */
const EXAMPLE_REACTIONS = ['❤️', '😂', '🥹'] as const;

function pageFrom(param: string | string[] | undefined): 1 | 2 | 3 {
  const n = Number(Array.isArray(param) ? param[0] : param);
  return n === 2 ? 2 : n === 3 ? 3 : 1;
}

/** The names typed on 07 (asked before the story, D50); "your partner" / "You" when empty. */
function useNames() {
  const { t } = useTranslation();
  const me = useOnboarding((s) => s.displayName).trim();
  const partner = useOnboarding((s) => s.partnerName).trim();
  return {
    me: me || t('onboarding.meFallback'),
    partner: partner || t('onboarding.partnerFallback'),
    /** For a card header, which starts with the name. */
    partnerTitle: partner || capitalize(t('onboarding.partnerFallback')),
  };
}

/**
 * 02: the chat noise, in one of four versions picked by the stage from 05 (D50; living together
 * when no stage is known). The body names the partner. The bubbles pop in one by one, once;
 * reduced motion shows them at once.
 */
function LifeGetsLoud() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const reduced = useReducedMotion();
  const variant = storyVariant(useOnboarding((s) => s.stage));
  const { partner } = useNames();
  const bubbles = BUBBLE_KEYS.map((key) => t(`onboarding.story.${variant}.bubbles.${key}`));
  const [shown, setShown] = useState(reduced ? bubbles.length : 0);

  useEffect(() => {
    if (reduced) return undefined;
    if (shown >= bubbles.length) return undefined;
    const timer = setTimeout(() => setShown((n) => n + 1), BUBBLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reduced, shown, bubbles.length]);

  return (
    <>
      {/* Decorative: the body text says it, so screen readers skip the bubbles. */}
      <View
        testID="02-bubbles"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ gap: space.sm }}
      >
        {bubbles.slice(0, shown).map((text, i) => (
          <ChatBubble key={`${i}-${text}`} isMe={i % 2 === 1} text={text} senderName="" />
        ))}
      </View>
      <View testID={`02-${variant}`} style={{ alignItems: 'center', gap: space.md }}>
        <Mascot mood="waiting" size={120} accessibilityLabel={t('onboarding.story1Mascot')} />
        <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t(`onboarding.story.${variant}.title`)}
        </Text>
        <Text testID="02-body" tone="text2" style={{ textAlign: 'center' }}>
          {t(`onboarding.story.${variant}.body`, { partner })}
        </Text>
      </View>
    </>
  );
}

/**
 * 03: "When did you last learn something new about <partner>?" (quiz 3 of 4). Private: only
 * stored for me (D38, `last_learned`, questionnaire v2), never shown to the partner.
 */
function LastLearned() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const { partner } = useNames();
  const lastLearned = useOnboarding((s) => s.lastLearned);
  const setLastLearned = useOnboarding((s) => s.setLastLearned);
  return (
    <>
      <View style={{ gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Mascot
            mood="snuggled"
            size={72}
            accessibilityLabel={t('onboarding.lastLearnedMascot')}
          />
          <Text testID="03-private" variant="caption" tone="text2" style={{ flex: 1 }}>
            {t('onboarding.lastLearnedPrivate', { partner })}
          </Text>
        </View>
        <Text testID="03-title" variant="h1" accessibilityRole="header">
          {t('onboarding.lastLearned', { partner })}
        </Text>
      </View>
      <View style={{ gap: space.sm + 2 }} accessibilityRole="radiogroup">
        {LAST_LEARNED.map((value) => (
          <OptionRow
            key={value}
            testID={`03-${value}`}
            label={t(`onboarding.lastLearnedOptions.${value}`)}
            description={t(`onboarding.lastLearnedHints.${value}`)}
            selected={lastLearned === value}
            onPress={() => setLastLearned(value)}
          />
        ))}
      </View>
    </>
  );
}

/**
 * 04: how it works, as the payoff (D50): the revealed-answer cards of 21 with an everyday example
 * question (not the day-1 question), two answer cards with the couple's names, and reaction pills.
 * Example copy only: nothing here is a real answer or is sent anywhere.
 */
function HowItWorks() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const { me, partnerTitle } = useNames();
  const [reaction, setReaction] = useState<string | null>('❤️');
  return (
    <>
      <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
        {t('onboarding.howTitle')}
      </Text>
      <View testID="04-example" style={{ gap: space.md }}>
        <Text testID="04-question" variant="h2">
          {t('onboarding.howQuestion')}
        </Text>
        <AnswerCard
          testID="04-partner-card"
          name={partnerTitle}
          isMe={false}
          time={t('onboarding.howPartnerTime')}
          body={t('onboarding.howPartnerAnswer')}
        >
          <View testID="04-reactions" style={{ flexDirection: 'row', gap: space.sm - 2 }}>
            {EXAMPLE_REACTIONS.map((kind) => (
              <ReactionPill
                key={kind}
                testID={`04-reaction-${EXAMPLE_REACTIONS.indexOf(kind)}`}
                kind={kind}
                count={reaction === kind ? 1 : 0}
                selected={reaction === kind}
                onPress={() => setReaction((current) => (current === kind ? null : kind))}
              />
            ))}
          </View>
        </AnswerCard>
        <AnswerCard
          testID="04-my-card"
          name={me}
          isMe
          time={t('onboarding.howMyTime')}
          body={t('onboarding.howMyAnswer')}
        />
      </View>
    </>
  );
}

const PAGE_STEP: Record<1 | 2 | 3, OnboardingStep> = {
  1: '/story/1',
  2: '/story/2',
  3: '/story/3',
};

/** 02, 03, 04 (`/story/1` to `/story/3`). D50 order: 07 → 02 → 03 → 04 → 06 (`flow.ts`). */
export default function OnboardingStoryStepRoute() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const page = pageFrom(useLocalSearchParams<{ step?: string }>().step);
  const nav = useStepNav(PAGE_STEP[page]);
  const screenId = `0${page + 1}`;

  return (
    <OnboardingFrame
      key={page}
      screenId={screenId}
      {...(page === 2 ? { step: QUIZ_STEP['03'] } : {})}
      onBack={nav.back}
      footer={
        <>
          {page === 1 ? <PageDots testID="02-dots" page={1} total={STORY_PAGES} /> : null}
          <Button
            testID={`${screenId}-next`}
            label={page === 3 ? t('onboarding.letsStart') : t('onboarding.continue')}
            onPress={nav.next}
          />
          {page === 3 ? (
            <View
              testID="04-psychology"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.xs + 2,
              }}
            >
              <Icon name="flask" size={16} color={colors.youText} />
              <Text variant="caption" tone="youText">
                {t('onboarding.howPsychology')}
              </Text>
            </View>
          ) : null}
        </>
      }
    >
      {page === 1 ? <LifeGetsLoud /> : page === 2 ? <LastLearned /> : <HowItWorks />}
    </OnboardingFrame>
  );
}
