import { Redirect } from 'expo-router';

import { GalleryScreen } from '@/dev/gallery/GalleryScreen';

/** Screen 54 / MOB-04: the component gallery exists in development builds only. */
export default function GalleryRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <GalleryScreen />;
}
