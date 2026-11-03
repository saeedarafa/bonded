import { createContext, useContext, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * #65/#66: below this many "text-scaled points" of window height a pinned footer or header leaves
 * too little room for the body (iPhone SE at 200% text: 667 / 2 = 333; any phone at AX5).
 */
export const CRAMPED_POINTS = 420;

/** Pure: is the screen short for its text size? */
export function isCramped(height: number, fontScale: number): boolean {
  return height / Math.max(1, fontScale) < CRAMPED_POINTS;
}

const Override = createContext<boolean | null>(null);

/** Tests and the gallery force the small-screen layout on or off. */
export function CrampedOverride({ value, children }: { value: boolean; children: ReactNode }) {
  return <Override.Provider value={value}>{children}</Override.Provider>;
}

/**
 * True on a short screen at a large text size: frames then scroll their pinned action (and Today
 * its header) with the body instead of pinning them.
 */
export function useCramped(): boolean {
  const forced = useContext(Override);
  const { height, fontScale } = useWindowDimensions();
  return forced ?? isCramped(height, fontScale);
}
