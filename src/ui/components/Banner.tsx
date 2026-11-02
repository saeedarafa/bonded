import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

export type BannerTone = 'offline' | 'error';

type Props = {
  message: string;
  tone?: BannerTone;
  icon?: IconName;
  testID?: string;
};

/** Inline strip under the top bar. Announced politely; never blocks the screen. */
export function Banner({ message, tone = 'offline', icon, testID }: Props) {
  const { colors, space } = useTheme();
  const palette =
    tone === 'error'
      ? { bg: colors.blushTint, fg: colors.blushText }
      : { bg: colors.surface2, fg: colors.text2 };
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 44,
        paddingHorizontal: space.gutter,
        paddingVertical: space.sm,
        backgroundColor: palette.bg,
      }}
    >
      <Icon
        name={icon ?? (tone === 'offline' ? 'wifiOff' : 'close')}
        size={16}
        color={palette.fg}
      />
      <Text variant="caption" style={{ color: palette.fg, flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

/** True while the device is offline (the same signal TanStack Query uses to pause fetches). */
export function useIsOffline(): boolean {
  return !useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/**
 * The offline banner: shows itself only while offline. Writes queue offline (MOB-14); a screen
 * can say what waits (55: "Your answer will send when you're back").
 */
export function OfflineBanner({ message }: { message?: string }) {
  const { t } = useTranslation();
  const offline = useIsOffline();
  return offline ? <Banner message={message ?? t('ui.offline')} testID="offline-banner" /> : null;
}
