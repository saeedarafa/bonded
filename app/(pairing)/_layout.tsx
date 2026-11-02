import { Stack } from 'expo-router';

import { useActiveCouple } from '@/features/couple/hooks';
import { useCoupleRealtime } from '@/lib/useCoupleRealtime';

/**
 * Pairing screens (10 to 13). Subscribes to the couple's realtime channel so the inviter finds out
 * the moment the partner joins (`couple_members` insert invalidates the couple query).
 */
export default function PairingLayout() {
  const couple = useActiveCouple();
  useCoupleRealtime(couple.data?.id);
  return <Stack screenOptions={{ headerShown: false }} />;
}
