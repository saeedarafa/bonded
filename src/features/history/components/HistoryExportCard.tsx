import { Pressable, View } from 'react-native';

import type { EndedCouple } from '@/features/settings/api';
import { useTranslation } from '@/i18n';
import { Banner, Icon, Text, useTheme } from '@/ui';

import { exportErrorMessage, useHistoryExport } from '../exportHooks';

/**
 * MOB-27 (58): the "Download your history" card. Tapping it builds the PDF of the ended couple's
 * History and opens the share sheet; while it works the caption says so (no spinner, no disabled
 * state: a second tap is ignored). A failure shows an error banner under the card, which stays
 * tappable to try again. Also used at the end of the archive list (`/ended`, GAPS MOB-27).
 * MOB-27b: the export reads the partner's name itself, so the card needs no name and a tap before
 * the screen's name has loaded still prints it.
 */
export function HistoryExportCard({ couple, testID }: { couple: EndedCouple; testID: string }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const exporter = useHistoryExport(couple);
  const busy = exporter.isPending;
  const caption = busy ? t('history.export.busy') : t('settings.partnerLeft.downloadBody');

  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${t('settings.partnerLeft.download')}. ${caption}`}
        accessibilityHint={t('history.export.a11yHint')}
        accessibilityState={{ busy }}
        onPress={() => {
          if (!busy) exporter.mutate();
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          minHeight: 44,
          backgroundColor: pressed ? colors.surface2 : colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.input - 4,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface2,
          }}
        >
          <Icon name="download" size={20} color={colors.text2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label">{t('settings.partnerLeft.download')}</Text>
          <Text variant="caption" tone="text3" testID={`${testID}-caption`}>
            {caption}
          </Text>
        </View>
      </Pressable>
      {exporter.isError ? (
        <Banner
          tone="error"
          testID={`${testID}-error`}
          message={exportErrorMessage(exporter.error, t('history.export.error'))}
        />
      ) : null}
    </View>
  );
}
