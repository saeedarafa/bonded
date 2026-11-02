import { Tabs } from 'expo-router';

import { useTheme } from '@/ui';

// Tab icons and translated labels come with MOB-04 / MOB-29.
export default function TabsLayout() {
  const { colors, type } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.youText,
        tabBarInactiveTintColor: colors.text3,
        tabBarLabelStyle: type.caption,
      }}
    >
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="packs" options={{ title: 'Packs' }} />
      <Tabs.Screen name="us" options={{ title: 'Us' }} />
    </Tabs>
  );
}
