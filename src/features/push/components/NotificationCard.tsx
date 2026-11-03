import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Mascot, Text, useTheme } from '@/ui';

type Props = {
  title: string;
  body: string;
  /** Right of "BONDED": the ritual time on 09 / J6, "now" in the in-app banner. */
  time: string;
  testID?: string;
};

/**
 * The notification card from boards 09, J6 and 37: mascot, app name, time, title, body. Purely
 * visual; the in-app banner (37) wraps it in a pressable.
 */
export function NotificationCard({ title, body, time, testID }: Props) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md + 2,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface2,
      }}
    >
      {/* The app icon of a notification: decoration, the title says it all. */}
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Mascot mood="together" size={40} />
      </View>
      <View style={{ flex: 1, gap: space.xs / 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <Text variant="caption" tone="text2">
            {t('push.appName')}
          </Text>
          <Text variant="caption" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>
            {time}
          </Text>
        </View>
        <Text variant="label">{title}</Text>
        {body ? (
          <Text variant="caption" tone="text2">
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
