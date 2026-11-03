import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { PageDots } from '@/features/onboarding/PageDots';
import { LAST_LEARNED, useOnboarding } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { Button, ChatBubble, Mascot, OptionRow, Text, useReducedMotion, useTheme } from '@/ui';

const STORY_PAGES = 3;
const BUBBLE_DELAY_MS = 450;

const BUBBLE_KEYS = ['b1', 'b2', 'b3', 'b4', 'b5'] as const;
const HOW_KEYS = ['same', 'locked', 'reveal'] as const;

function pageFrom(param: string | string[] | undefined): 1 | 2 | 3 {
  const n = Number(Array.isArray(param) ? param[0] : param);
  return n === 2 ? 2 : n === 3 ? 3 : 1;
}

/** 02: the chat noise. The bubbles pop in one by one, once; reduced motion shows them at once. */
function LifeGetsLoud() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const reduced = useReducedMotion();
  const bubbles = BUBBLE_KEYS.map((key) => t(`onboarding.bubbles.${key}`));
  const [shown, setShown] = useState(reduced ? bubbles.length : 0);

  useEffect(() => {
    if (reduced) return undefined;
    if (shown >= bubbles.length) return undefined;
    const timer = setTimeout(() => setShown((n) => n + 1), BUBBLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reduced, shown, bubbles.length]);

  return (
    <>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <Mascot mood="waiting" size={120} accessibilityLabel={t('onboarding.story1Mascot')} />
        <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('onboarding.story1Title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('onboarding.story1Body')}
        </Text>
      </View>
      {/* Decorative: the body text says it, so screen readers skip the bubbles. */}
      <View
        testID="02-bubbles"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ gap: space.sm }}
      >
        {bubbles.slice(0, shown).map((text, i) => (
          <ChatBubble key={text} isMe={i % 2 === 1} text={text} senderName="" />
        ))}
      </View>
    </>
  );
}

/** 03: "when did you last learn something new about your partner?" Kept locally. */
function ThingsGoQuiet() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const lastLearned = useOnboarding((s) => s.lastLearned);
  const setLastLearned = useOnboarding((s) => s.setLastLearned);
  return (
    <>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <Mascot mood="napping" size={120} />
        <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('onboarding.story2Title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('onboarding.story2Body')}
        </Text>
      </View>
      <View style={{ gap: space.sm }}>
        <Text variant="caption" tone="text2">
          {t('onboarding.honestCaption')}
        </Text>
        <Text variant="h2" accessibilityRole="header">
          {t('onboarding.lastLearned')}
        </Text>
        {LAST_LEARNED.map((value) => (
          <OptionRow
            key={value}
            testID={`03-${value}`}
            label={t(`onboarding.lastLearnedOptions.${value}`)}
            selected={lastLearned === value}
            onPress={() => setLastLearned(value)}
          />
        ))}
      </View>
    </>
  );
}

/** 04: how it works, three rows. */
function HowItWorks() {
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const rows = HOW_KEYS.map((key) => ({
    title: t(`onboarding.how.${key}.title`),
    body: t(`onboarding.how.${key}.body`),
  }));
  return (
    <>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <Mascot mood="together" size={120} />
        <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('onboarding.story3Title')}
        </Text>
      </View>
      <View style={{ gap: space.md }}>
        {rows.map((row, i) => (
          <View
            key={row.title}
            accessible
            accessibilityLabel={`${i + 1}. ${row.title}. ${row.body}`}
            style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}
          >
            <View
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={{
                width: 32,
                height: 32,
                borderRadius: radius.pill,
                backgroundColor: colors.youTint,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="label" tone="youText">
                {i + 1}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label">{row.title}</Text>
              <Text variant="caption" tone="text2">
                {row.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

/** 02, 03, 04: the three story pages (`/story/1` to `/story/3`). */
export default function OnboardingStoryStepRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const page = pageFrom(useLocalSearchParams<{ step?: string }>().step);
  const last = page === STORY_PAGES;
  const screenId = `0${page + 1}`;

  return (
    <OnboardingFrame
      key={page}
      screenId={screenId}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      footer={
        <>
          <PageDots testID={`${screenId}-dots`} page={page} total={STORY_PAGES} />
          <Button
            testID={`${screenId}-next`}
            label={last ? t('onboarding.letsStart') : t('onboarding.continue')}
            onPress={() => router.push(last ? '/quiz/stage' : `/story/${page + 1}`)}
          />
        </>
      }
    >
      {page === 1 ? <LifeGetsLoud /> : page === 2 ? <ThingsGoQuiet /> : <HowItWorks />}
    </OnboardingFrame>
  );
}
