// Hand-written stand-in for react-native-reanimated in Jest (MOB-04), see reanimated-entry.ts. Reanimated 4's own mock
// pulls in the native runtime and fails under Jest ("setCSSEventHandler is not available"), and
// expo-router's test setup falls back to an empty object when it does. Mapped in package.json
// (`moduleNameMapper`) for both `react-native-reanimated` and `react-native-reanimated/mock`, so
// it wins everywhere. Animations jump to their end value; anything that depends on time is driven
// by JS timers in the component and tested there.
import { useState } from 'react';
import { View } from 'react-native';

const identity = <T,>(value: T): T => value;
const createAnimatedComponent = <T,>(component: T): T => component;

export const Easing = {
  linear: 'linear',
  ease: 'ease',
  bezier: () => 'bezier',
  out: identity,
  inOut: identity,
};

export function useSharedValue<T>(initial: T): { value: T } {
  return useState(() => ({ value: initial }))[0];
}

export const useAnimatedStyle = (factory: () => object): object => factory();
export const useAnimatedProps = (factory: () => object): object => factory();
export const withTiming = (value: unknown): unknown => value;
export const withSpring = (value: unknown): unknown => value;
export const withRepeat = (value: unknown): unknown => value;
export const withDelay = (_ms: number, value: unknown): unknown => value;
export const withSequence = (...values: unknown[]): unknown => values[values.length - 1];
export const cancelAnimation = (): void => undefined;
export const runOnJS = <T,>(fn: T): T => fn;
export const interpolate = identity;

const Animated = { View, createAnimatedComponent, call: () => undefined };

export { Animated as default, View, createAnimatedComponent };
export type SharedValue<T> = { value: T };
export type EasingFunction = (t: number) => number;
