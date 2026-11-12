import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { DeviceEventEmitter, TextInput, type LayoutChangeEvent } from 'react-native';

import { useFocusedFieldInView } from '../useFocusedFieldInView';
import { ReducedMotionOverride } from '../useReducedMotion';

/** A focused field 600 pt down in a 300 pt viewport: it has to scroll. */
async function setup(reduced: boolean) {
  const scrollTo = jest.fn();
  const inner = {};
  const scroll = { current: { getInnerViewRef: () => inner, scrollTo } };
  const field = {
    measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) =>
      ok(0, 600, 300, 48),
  };
  jest
    .spyOn(TextInput.State, 'currentlyFocusedInput')
    .mockReturnValue(field as unknown as ReturnType<typeof TextInput.State.currentlyFocusedInput>);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReducedMotionOverride value={reduced}>{children}</ReducedMotionOverride>
  );
  const { result } = await renderHook(() => useFocusedFieldInView(scroll as never, 16), {
    wrapper,
  });
  await act(async () => {
    result.current.onLayout({ nativeEvent: { layout: { height: 300 } } } as LayoutChangeEvent);
  });
  return scrollTo;
}

async function keyboardOpens() {
  await act(async () => {
    DeviceEventEmitter.emit('keyboardDidShow', { endCoordinates: { height: 300, screenY: 500 } });
    jest.advanceTimersByTime(100);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useFocusedFieldInView', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('glides the focused field into view', async () => {
    const scrollTo = await setup(false);
    await keyboardOpens();
    expect(scrollTo).toHaveBeenCalledWith({ y: 364, animated: true });
  });

  it('Reduce Motion: jumps instead of gliding (MOB-25)', async () => {
    const scrollTo = await setup(true);
    await keyboardOpens();
    expect(scrollTo).toHaveBeenCalledWith({ y: 364, animated: false });
  });
});
