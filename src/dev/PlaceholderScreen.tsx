import { usePathname } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, useTheme } from '@/ui';

type Props = {
  /** Screen id from design-handoff/screens.json, e.g. "20" or "J3". */
  screenId: string;
  name: string;
};

/**
 * Temporary stand-in for a screen that isn't built yet (MOB-01 scaffold).
 * Replaced screen by screen; strings move to t() in MOB-29.
 */
export function PlaceholderScreen({ screenId, name }: Props) {
  const pathname = usePathname();
  const { colors, type } = useTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.body} accessible accessibilityLabel={`Placeholder: ${name}`}>
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
