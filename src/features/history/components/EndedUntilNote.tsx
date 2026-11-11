import { View } from 'react-native';

import { untilLabel } from '@/features/history/ended';
import { deviceLocale, useTranslation } from '@/i18n';
import { Icon, Text, useTheme } from '@/ui';

/**
 * MOB-70 (D08, PO 2026-11-11): the visible note on the ended couple's answers: "You can read these
 * until 12 Dec. After that they're deleted." The date is `ended_at` + 30 days in the phone's own
 * locale and time zone. Read as one sentence by the screen reader. No board: GAPS 2026-11-11.
 */
export function EndedUntilNote({ until, testID }: { until: Date; testID: string }) {
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const text = t('history.ended.note', { date: untilLabel(until, deviceLocale()) });
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface2,
      }}
    >
      <View style={{ paddingTop: 3 }}>
        <Icon name="clock" size={16} color={colors.text2} />
      </View>
      <Text tone="text2" style={{ flex: 1 }} testID={`${testID}-text`}>
        {text}
      </Text>
    </View>
  );
}
