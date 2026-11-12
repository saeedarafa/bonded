import { screen } from '@testing-library/react-native';
import type * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';

import { renderUi } from '@/test/render';
import { TITLE_MAX_FONT_SCALE } from '@/ui';

import { STAGE_STACK_FONT_SCALE, StageTile } from '../components';

// #367: at AX5 on an iPhone SE the 2×2 stage tiles broke their labels mid-word
// ("Lon / g- / dist / anc / e"). From 150% they go one per row; the label stops at 200%.
function tile() {
  return renderUi(
    <StageTile
      testID="05-long_distance"
      icon="send"
      label="Long-distance"
      selected={false}
      onPress={() => {}}
    />,
  );
}

function withFontScale(fontScale: number) {
  // The module object itself (an `import * as` copy would not reach the component).
  const rn = jest.requireActual<typeof ReactNative>('react-native');
  jest
    .spyOn(rn, 'useWindowDimensions')
    .mockReturnValue({ width: 375, height: 667, scale: 2, fontScale });
}

const basis = () =>
  StyleSheet.flatten(screen.getByTestId('05-long_distance').props.style).flexBasis;

afterEach(() => jest.restoreAllMocks());

describe('05 StageTile at large text (#367)', () => {
  it('default text: two tiles a row', async () => {
    withFontScale(1);
    await tile();
    expect(basis()).toBe('40%');
  });

  it.each([STAGE_STACK_FONT_SCALE, 2, 3.1])('font scale %p: one tile a row', async (scale) => {
    withFontScale(scale);
    await tile();
    expect(basis()).toBe('100%');
  });

  it('the label stops at 200% and is never truncated', async () => {
    withFontScale(3.1);
    await tile();
    const label = screen.getByText('Long-distance');
    expect(label.props.maxFontSizeMultiplier).toBe(TITLE_MAX_FONT_SCALE);
    expect(label.props.numberOfLines).toBeUndefined();
  });
});
