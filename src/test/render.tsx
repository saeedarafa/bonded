import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ReducedMotionOverride } from '@/ui/useReducedMotion';
import { FontScaleOverride, SchemeOverride } from '@/ui/ThemeProvider';
import type { ColorScheme } from '@/ui/theme';

type Options = { scheme?: ColorScheme; fontScale?: number; reducedMotion?: boolean };

/** Render a component in a fixed scheme, font scale and motion setting (RNTL 14: await it). */
export async function renderUi(
  ui: ReactElement,
  { scheme = 'light', fontScale = 1, reducedMotion = false }: Options = {},
) {
  return render(
    <SchemeOverride scheme={scheme}>
      <FontScaleOverride scale={fontScale}>
        <ReducedMotionOverride value={reducedMotion}>{ui}</ReducedMotionOverride>
      </FontScaleOverride>
    </SchemeOverride>,
  );
}
