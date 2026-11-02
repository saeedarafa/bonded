import { useEffect } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

export type ToastTone = 'success' | 'error' | 'info';

/** DESIGN.md: toasts auto-hide after 3 s. */
export const TOAST_MS = 3000;

type ToastState = {
  toast: { id: number; message: string; tone: ToastTone } | null;
  show: (message: string, tone?: ToastTone) => void;
  hide: () => void;
};

let nextId = 1;

/** UI-only state (Zustand): `useToast.getState().show(t('...'))` from anywhere, e.g. a mutation's onSuccess. */
export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (message, tone = 'success') => set({ toast: { id: nextId++, message, tone } }),
  hide: () => set({ toast: null }),
}));

const icons: Record<ToastTone, IconName> = { success: 'check', error: 'close', info: 'bell' };

type ToastProps = { message: string; tone?: ToastTone; testID?: string };

/** The toast itself: dark pill on light, light pill on dark. Slides in once (200 ms). */
export function Toast({ message, tone = 'success', testID }: ToastProps) {
  const { colors, radius, space, motion } = useTheme();
  const reduced = useReducedMotion();
  const enter = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) enter.value = withTiming(1, { duration: motion.duration.fast });
  }, [reduced, enter, motion.duration.fast]);

  useEffect(() => {
    // Android reads liveRegion; iOS needs an explicit announcement.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -12 }],
  }));

  const iconColor = tone === 'error' ? colors.blush : colors.you;
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm + 2,
          paddingHorizontal: space.lg - 2,
          paddingVertical: space.md,
          borderRadius: radius.input,
          backgroundColor: colors.text,
        },
        style,
      ]}
    >
      <Icon name={icons[tone]} size={18} strokeWidth={2.5} color={iconColor} />
      <Text variant="label" style={{ color: colors.bg, flex: 1 }}>
        {message}
      </Text>
    </Animated.View>
  );
}

/** Mount once at the root, inside the safe-area provider. Shows the latest toast for 3 s. */
export function ToastHost() {
  const toast = useToast((s) => s.toast);
  const hide = useToast((s) => s.hide);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(hide, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, hide]);

  if (!toast) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16 }}
    >
      <Toast key={toast.id} message={toast.message} tone={toast.tone} testID="toast" />
    </View>
  );
}
