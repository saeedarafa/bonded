import { Stack } from 'expo-router';

/** MOB-50: an ended couple's History, read-only for 30 days (D08). Outside the tabs: 58 opens it. */
export default function EndedHistoryLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
