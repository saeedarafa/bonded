import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import { useReducedMotion, useTheme } from '@/ui';

import { usePushRoute } from '../store';
import { NotificationCard } from './NotificationCard';

/** A push in the foreground stays up a little longer than a toast (3 s): it can be tapped. */
export const PUSH_BANNER_MS = 4000;

/**
 * 37 in the app: a push that arrives while Bonded is open drops in at the top (once, 200 ms;
 * still with reduced motion), and a tap opens what it is about. Mount once at the root.
 */
export function PushBannerHost() {
  const banner = usePushRoute((s) => s.banner);
  const hide = usePushRoute((s) => s.hideBanner);
  const insets = useSafeAreaInsets();
  const { space } = useTheme();

  useEffect(() => {
    if (!banner) return undefined;
    const timer = setTimeout(hide, PUSH_BANNER_MS);
    return () => clearTimeout(timer);
  }, [banner, hide]);

  if (!banner) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + space.sm,
        left: space.lg,
        right: space.lg,
      }}
    >
      <PushBanner key={banner.id} />
    </View>
  );
}

function PushBanner() {
  const router = useRouter();
  const { t } = useTranslation();
  const { motion } = useTheme();
  const reduced = useReducedMotion();
  const banner = usePushRoute((s) => s.banner);
  const hide = usePushRoute((s) => s.hideBanner);
  const enter = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) enter.value = withTiming(1, { duration: motion.duration.fast });
  }, [reduced, enter, motion.duration.fast]);

  const label = banner ? [banner.title, banner.body].filter(Boolean).join('. ') : '';
  useEffect(() => {
    if (label && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(label);
  }, [label]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -16 }],
  }));

  if (!banner) return null;
  return (
    <Animated.View style={style}>
      <Pressable
        testID="37-banner"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t('push.banner.hint')}
        accessibilityLiveRegion="polite"
        onPress={() => {
          hide();
          router.push(banner.href);
        }}
      >
        <NotificationCard title={banner.title} body={banner.body} time={t('push.banner.now')} />
      </Pressable>
    </Animated.View>
  );
}
