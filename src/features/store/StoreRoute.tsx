import { Redirect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { StoreFrame, Scaled } from './StoreFrame';
import { C } from './StoreScreen';
import {
  STORE_FRAME,
  fitScale,
  isStoreMode,
  isStorePlatform,
  isStoreShotId,
  type StorePlatform,
} from './storeMode';

/**
 * `/store/<shot>?platform=ios|android` (MOB-26, screens 60 and 61): one store frame, fitted to the
 * window and pinned to the top-left, status bar hidden, for the capture script. Store mode only;
 * every other build sends the link home.
 */
export default function StoreRoute() {
  const params = useLocalSearchParams<{ shot?: string; platform?: string }>();
  const window = useWindowDimensions();
  if (!isStoreMode() || !isStoreShotId(params.shot)) return <Redirect href="/" />;
  const platform: StorePlatform = isStorePlatform(params.platform) ? params.platform : 'ios';
  const f = STORE_FRAME[platform];
  const scale = fitScale(f.width, f.height, window.width, window.height);
  return (
    <View style={[styles.fill, { backgroundColor: C.text }]} testID="store-route">
      <StatusBar hidden />
      <Scaled width={f.width} height={f.height} scale={scale}>
        <StoreFrame shot={params.shot} platform={platform} />
      </Scaled>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
