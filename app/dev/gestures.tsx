import { Redirect } from 'expo-router';

import { GestureScreen } from '@/dev/gestures/GestureScreen';

/** MOB-66: little-things moments on demand, in development builds only. */
export default function GesturesRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <GestureScreen />;
}
