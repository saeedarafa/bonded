import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BadgePop } from '@/features/badges/components/BadgePop';
import { parseStep } from '@/features/badges/model';
import { useReviewOnClose } from '@/features/review/review';
import { useTranslation } from '@/i18n';
import { Button, Confetti, haptics, Mascot, Text, useTheme } from '@/ui';

/**
 * 25 Milestone (7, 30, 100 days), a modal over Today. Heavy haptic and three bursts of confetti
 * (DESIGN.md §6); reduced motion: no confetti, the badge fades in. However it closes (Keep going,
 * swipe down, Android back), the native in-app review may follow (src/features/review, D62: day 2
 * and later, never in the first session). Sharing sends a fixed line, never answer text.
 */
export default function MilestoneScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const params = useLocalSearchParams<{ n?: string }>();
  const n = parseStep(params.n);
  const [confetti, setConfetti] = useState(true);

  useEffect(() => {
    if (n === null) return;
    haptics.heavy();
    AccessibilityInfo.announceForAccessibility(t('milestone.announce', { n }));
  }, [n, t]);

  // Runs when the modal leaves the stack, however it was closed: the OS sheet shows over Today.
  useReviewOnClose('milestone', n !== null);

  if (n === null) return <Redirect href="/today" />;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/today'));
  const share = () => {
    void Share.share({ message: t('milestone.shareMessage', { n }) }).catch(() => undefined);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="25-screen">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          paddingHorizontal: space.gutter,
          paddingTop: space.hero,
          paddingBottom: space.xl,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.md }}>
          <View style={{ width: 220, height: 220, alignItems: 'center', justifyContent: 'center' }}>
            <Mascot mood="celebrating" size={180} />
            <View style={{ position: 'absolute', right: 0, bottom: space.sm }}>
              <BadgePop>
                <View
                  testID="25-badge"
                  accessible
                  accessibilityLabel={t('milestone.badgeA11y', { n })}
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 38,
                    borderWidth: 4,
                    borderColor: colors.premium,
                    backgroundColor: colors.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* Fixed circle: the label above carries the number for large text. */}
                  <Text
                    variant="h1"
                    allowFontScaling={false}
                    style={{ color: colors.premiumText, fontVariant: ['tabular-nums'] }}
                  >
                    {n}
                  </Text>
                </View>
              </BadgePop>
            </View>
          </View>
          <Text
            variant="h1"
            accessibilityRole="header"
            style={{ textAlign: 'center' }}
            testID="25-title"
          >
            {t('milestone.title', { n })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('milestone.body', { n })}
          </Text>
        </View>
        <View style={{ gap: space.md }}>
          <Button testID="25-share" icon="share" label={t('milestone.share')} onPress={share} />
          <Button
            testID="25-keep-going"
            variant="ghost"
            label={t('milestone.keepGoing')}
            onPress={close}
          />
        </View>
      </ScrollView>
      <Confetti
        active={confetti}
        bursts={3}
        onDone={() => setConfetti(false)}
        testID="25-confetti"
      />
    </SafeAreaView>
  );
}
