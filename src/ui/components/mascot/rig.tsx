import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G } from 'react-native-svg';

import { MOTIONS, sampleMotion, type MotionName } from './motion';

/**
 * The Bao and Bun rig (D32, MOB-31; MOB-66 reuses it for the little-things gestures).
 *
 * A scene is a tree of `Layer`s. Each layer draws some SVG (`art`, in the 120 × 120 canvas,
 * placed by `frame`) and may play one looping keyframe `motion` around an `origin`; nested layers
 * move with their parent (a blink inside a breathing dumpling).
 *
 * - **Still** (Reduce Motion, below the face size, `still`, widgets): one `<Svg>`; every layer is
 *   a `<G>` at its rest pose. Nothing is scheduled.
 * - **Animated:** every layer is an `Animated.View` the size of the canvas holding its own `<Svg>`,
 *   transformed by a Reanimated style on the UI thread (view transforms are what Reanimated
 *   animates natively on both platforms; no JS timers, no per-frame React renders).
 */

export const CANVAS = 120;

type Rig = { animated: boolean; size: number };

const RigContext = createContext<Rig>({ animated: false, size: CANVAS });

export function RigProvider({ animated, size, children }: Rig & { children: ReactNode }) {
  return <RigContext.Provider value={{ animated, size }}>{children}</RigContext.Provider>;
}

export function useRig(): Rig {
  return useContext(RigContext);
}

export type LayerProps = {
  /** Looping motion from `MOTIONS`; none = a static layer. */
  motion?: MotionName;
  /** Wait before the first loop, ms (the 0 % frame shows meanwhile, like CSS). */
  delay?: number;
  /** Canvas point (0..120) the layer scales and rotates around. Default: the canvas centre. */
  origin?: readonly [number, number];
  /** Opacity of the still pose. Default 1. */
  restOpacity?: number;
  /** SVG transform that places `art` on the canvas (e.g. a dumpling's translate and scale). */
  frame?: string;
  /** What this layer draws. */
  art?: ReactNode;
  /** Layers that move with this one, drawn over `art`. */
  children?: ReactNode;
  /** On the layer's view when animated (tests, MOB-66). */
  testID?: string;
};

export function Layer(props: LayerProps) {
  const { animated } = useRig();
  if (!animated) return <StillLayer {...props} />;
  return props.motion ? (
    <MovingLayer {...props} motion={props.motion} />
  ) : (
    <StaticLayer {...props} />
  );
}

function StillLayer({ restOpacity = 1, frame, art, children }: LayerProps) {
  const content = art ? frame ? <G transform={frame}>{art}</G> : art : null;
  if (restOpacity === 1) {
    return (
      <>
        {content}
        {children}
      </>
    );
  }
  return (
    <G opacity={restOpacity}>
      {content}
      {children}
    </G>
  );
}

function LayerArt({ frame, art }: Pick<LayerProps, 'frame' | 'art'>) {
  const { size } = useRig();
  if (!art) return null;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${CANVAS} ${CANVAS}`}>
      {frame ? <G transform={frame}>{art}</G> : art}
    </Svg>
  );
}

function StaticLayer({ frame, art, children, restOpacity = 1, testID }: LayerProps) {
  const { size } = useRig();
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[styles.fill, { width: size, height: size, opacity: restOpacity }]}
    >
      <LayerArt frame={frame} art={art} />
      {children}
    </View>
  );
}

function MovingLayer({
  motion,
  delay = 0,
  origin,
  frame,
  art,
  children,
  testID,
}: LayerProps & { motion: MotionName }) {
  const { size } = useRig();
  const k = size / CANVAS;
  const { keyframes, ease, duration } = MOTIONS[motion];
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [progress, delay, duration]);

  const style = useAnimatedStyle(() => {
    const pose = sampleMotion(keyframes, ease, progress.value);
    return {
      opacity: pose.op,
      transform: [
        { translateX: pose.tx * k },
        { translateY: pose.ty * k },
        { rotate: `${pose.rot}deg` },
        { scaleX: pose.sx },
        { scaleY: pose.sy },
      ],
    };
  });

  const [ox, oy] = origin ?? [CANVAS / 2, CANVAS / 2];
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.fill,
        { width: size, height: size, transformOrigin: [ox * k, oy * k, 0] },
        style,
      ]}
    >
      <LayerArt frame={frame} art={art} />
      {children}
    </Animated.View>
  );
}

/**
 * The scene's root. Still: one `<Svg>` carrying the accessibility props (as before MOB-31).
 * Animated: a `View` of the same size carrying them, with the layers stacked inside (the layers
 * are not accessible, so the root is one image either way).
 */
export function RigRoot({
  animated,
  size,
  children,
  testID,
  label,
}: Rig & { children: ReactNode; testID?: string; label: string }) {
  const a11y = { accessible: true, accessibilityRole: 'image', accessibilityLabel: label } as const;
  return (
    <RigProvider animated={animated} size={size}>
      {animated ? (
        <View testID={testID} style={{ width: size, height: size }} {...a11y}>
          {children}
        </View>
      ) : (
        <Svg
          testID={testID}
          width={size}
          height={size}
          viewBox={`0 0 ${CANVAS} ${CANVAS}`}
          {...a11y}
        >
          {children}
        </Svg>
      )}
    </RigProvider>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0 },
});
