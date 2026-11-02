import { Tabs } from 'expo-router';

// Tab bar visuals (icons, labels via t()) come with MOB-03 / MOB-04 / MOB-29.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="today" options={{ title: 'Today' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="packs" options={{ title: 'Packs' }} />
      <Tabs.Screen name="us" options={{ title: 'Us' }} />
    </Tabs>
  );
}
