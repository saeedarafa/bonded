import { Tabs } from 'expo-router';

import { useTranslation } from '@/i18n';
import { useTheme } from '@/ui';

// Tab icons come with MOB-04.
export default function TabsLayout() {
  const { colors, type } = useTheme();
  const { t } = useTranslation();
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
      <Tabs.Screen name="today" options={{ title: t('tabs.today') }} />
      <Tabs.Screen name="history" options={{ title: t('tabs.history') }} />
      <Tabs.Screen name="packs" options={{ title: t('tabs.packs') }} />
      <Tabs.Screen name="us" options={{ title: t('tabs.us') }} />
    </Tabs>
  );
}
