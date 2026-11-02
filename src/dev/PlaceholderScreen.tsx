import { usePathname } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import type en from '@/i18n/locales/en.json';
import { space, useTheme } from '@/ui';

/** Screen id from design-handoff/screens.json, e.g. "20" or "J3"; its name is in the catalogue. */
export type ScreenId = keyof typeof en.screens;

type Props = { screenId: ScreenId };

/**
 * Temporary stand-in for a screen that isn't built yet (MOB-01 scaffold).
 * Replaced screen by screen; drop the screen's `screens.*` key when it is.
 */
export function PlaceholderScreen({ screenId }: Props) {
  const pathname = usePathname();
  const { colors, type } = useTheme();
  const { t } = useTranslation();
  const name = t(`screens.${screenId}`);
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <View
        style={styles.body}
        accessible
        accessibilityLabel={t('placeholder.a11yLabel', { name })}
      >
        <Text style={[type.h1, { color: colors.youText }]}>{screenId}</Text>
        <Text style={[type.h2, { color: colors.text }]}>{name}</Text>
        <Text style={[type.caption, { color: colors.text3 }]}>{pathname}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.gutter,
  },
});
