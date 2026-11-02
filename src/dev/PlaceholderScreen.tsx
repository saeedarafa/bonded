import { usePathname } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = {
  /** Screen id from design-handoff/screens.json, e.g. "20" or "J3". */
  screenId: string;
  name: string;
};

/**
 * Temporary stand-in for a screen that isn't built yet (MOB-01 scaffold).
 * Replaced screen by screen; no theme or i18n on purpose (MOB-03, MOB-29).
 */
export function PlaceholderScreen({ screenId, name }: Props) {
  const pathname = usePathname();
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body} accessible accessibilityLabel={`Placeholder: ${name}`}>
        <Text style={styles.id}>{screenId}</Text>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.path}>{pathname}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  id: { fontWeight: '700' },
  name: {},
  path: { opacity: 0.6 },
});
