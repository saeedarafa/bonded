import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';

import { Icon } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

type Props = {
  title?: string;
  /** Replaces the title with custom content (e.g. a progress bar and step count). */
  center?: ReactNode;
  /** Shows a back button. Android's hardware/gesture back is handled by the router. */
  onBack?: () => void;
  /** Right-hand actions (icon buttons must be at least 44 × 44). */
  right?: ReactNode;
  testID?: string;
};

export function TopBar({ title, center, onBack, right, testID }: Props) {
  const { t } = useTranslation();
  const { colors, size, space } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        minHeight: size.button,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.sm,
      }}
    >
      <View style={{ width: size.tapTarget, height: size.tapTarget }}>
        {onBack ? (
          <Pressable
            testID={testID && `${testID}-back`}
            accessibilityRole="button"
            accessibilityLabel={t('ui.back')}
            onPress={onBack}
            style={{
              width: size.tapTarget,
              height: size.tapTarget,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {center ??
          (title ? (
            <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {title}
            </Text>
          ) : null)}
      </View>
      <View style={{ minWidth: size.tapTarget, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}
