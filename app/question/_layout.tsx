import { Stack } from 'expo-router';

/** Push and deep-link targets `bonded://question/<id>` (MOB-15): each replaces itself at once. */
export default function QuestionLinkLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
}
