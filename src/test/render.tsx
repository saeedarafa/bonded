import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReducedMotionOverride } from '@/ui/useReducedMotion';
import { FontScaleOverride, SchemeOverride } from '@/ui/ThemeProvider';
import type { ColorScheme } from '@/ui/theme';

type Options = { scheme?: ColorScheme; fontScale?: number; reducedMotion?: boolean };

// iPhone 15 frame (DESIGN.md §4) with a notch and home indicator.
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Render a component in a fixed scheme, font scale and motion setting (RNTL 14: await it). */
export async function renderUi(
  ui: ReactElement,
  { scheme = 'light', fontScale = 1, reducedMotion = false }: Options = {},
) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SchemeOverride scheme={scheme}>
        <FontScaleOverride scale={fontScale}>
          <ReducedMotionOverride value={reducedMotion}>{ui}</ReducedMotionOverride>
        </FontScaleOverride>
      </SchemeOverride>
    </SafeAreaProvider>,
  );
}
