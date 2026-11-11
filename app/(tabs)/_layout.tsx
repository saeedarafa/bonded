import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRelockHistoryOnLapse } from '@/features/history/hooks';
import { useTranslation } from '@/i18n';
import { TabBar, type IconName, type TabItem } from '@/ui';

type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>['tabBar']>;
type TabBarProps = Parameters<TabBarRenderer>[0];

const icons: Record<string, IconName> = {
  today: 'today',
  history: 'history',
  packs: 'packs',
  us: 'us',
};

/** Adapts expo-router's tab state to the presentational TabBar (MOB-04). */
function AppTabBar({ state, descriptors, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const items: TabItem[] = state.routes.map((route, index) => ({
    key: route.key,
    label: descriptors[route.key]?.options.title ?? route.name,
    icon: icons[route.name] ?? 'today',
    focused: state.index === index,
    onPress: () => navigateToTab(route.key),
    testID: `tab-${route.name}`,
  }));
  return <TabBar items={items} bottomInset={insets.bottom} />;
}

export default function TabsLayout() {
  const { t } = useTranslation();
  // MOB-71 (D55): a Premium lapse relocks older History days at once (cached content dropped).
  useRelockHistoryOnLapse();
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="today" options={{ title: t('tabs.today') }} />
      <Tabs.Screen name="history" options={{ title: t('tabs.history') }} />
      <Tabs.Screen name="packs" options={{ title: t('tabs.packs') }} />
      <Tabs.Screen name="us" options={{ title: t('tabs.us') }} />
    </Tabs>
  );
}
