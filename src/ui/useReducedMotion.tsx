import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

const Override = createContext<boolean | null>(null);

/** Force reduced motion on or off for a subtree (gallery toggle, tests). */
export function ReducedMotionOverride({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return <Override.Provider value={value}>{children}</Override.Provider>;
}

/**
 * The OS "reduce motion" setting, live (DESIGN.md §6): still mascot, no confetti, no bounces or
 * pulses, hold-to-reveal becomes a tap with a confirmation.
 */
export function useReducedMotion(): boolean {
  const forced = useContext(Override);
  const [system, setSystem] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setSystem(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystem);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return forced ?? system;
}
