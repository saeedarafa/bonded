import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { DeviceEventEmitter, Keyboard, TextInput, type LayoutChangeEvent } from 'react-native';

import {
  createKeepInViewGroups,
  rectWithAction,
  useFocusedFieldInView,
} from '../useFocusedFieldInView';
import { ReducedMotionOverride } from '../useReducedMotion';

/** A view that reports where it sits in the scroll body. */
function measurable(y: number, height: number) {
  return {
    measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) =>
      ok(0, y, 300, height),
  };
}

/**
 * A focused field 600 pt down in a 300 pt viewport: it has to scroll. `action` is the primary
 * button's place in the body (MOB-86), when the screen passes one.
 */
async function setup(reduced: boolean, action?: { y: number; height: number }) {
  const scrollTo = jest.fn();
  const inner = {};
  const scroll = { current: { getInnerViewRef: () => inner, scrollTo } };
  const field = measurable(600, 48);
  const button = { current: action ? measurable(action.y, action.height) : null };
  jest
    .spyOn(TextInput.State, 'currentlyFocusedInput')
    .mockReturnValue(field as unknown as ReturnType<typeof TextInput.State.currentlyFocusedInput>);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReducedMotionOverride value={reduced}>{children}</ReducedMotionOverride>
  );
  const { result } = await renderHook(
    () => useFocusedFieldInView(scroll as never, 16, undefined, button as never),
    { wrapper },
  );
  await act(async () => {
    result.current.onLayout({ nativeEvent: { layout: { height: 300 } } } as LayoutChangeEvent);
  });
  return Object.assign(scrollTo, { hook: result });
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

  it('MOB-86: brings the primary button up with the field when both fit', async () => {
    // Field 600..648, button 700..756: 156 pt fits in 300 - 2 * 16. Bottom 756 + 16 - 300.
    const scrollTo = await setup(false, { y: 700, height: 56 });
    await keyboardOpens();
    expect(scrollTo).toHaveBeenCalledWith({ y: 472, animated: true });
  });

  it('MOB-86: a button too far below loses to the field (the caret stays visible)', async () => {
    const scrollTo = await setup(false, { y: 1000, height: 56 });
    await keyboardOpens();
    expect(scrollTo).toHaveBeenCalledWith({ y: 364, animated: true });
  });

  it('MOB-86: a growing multiline field re-reveals only while the keyboard is up', async () => {
    const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
    const scrollTo = await setup(false, { y: 700, height: 56 });
    await act(async () => {
      scrollTo.hook.current.onContentSizeChange();
      jest.advanceTimersByTime(100);
    });
    expect(scrollTo).not.toHaveBeenCalled();
    visible.mockReturnValue(true);
    await act(async () => {
      scrollTo.hook.current.onContentSizeChange();
      jest.advanceTimersByTime(100);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(scrollTo).toHaveBeenCalledWith({ y: 472, animated: true });
  });
});

describe('rectWithAction (MOB-86)', () => {
  const field = { y: 600, height: 48 };

  it('keeps the field alone when there is no button', () => {
    expect(rectWithAction(field, null, 300, 16)).toEqual(field);
  });

  it('spans field and a button below it when both fit', () => {
    expect(rectWithAction(field, { y: 700, height: 56 }, 300, 16)).toEqual({ y: 600, height: 156 });
  });

  it('spans a button above the field too', () => {
    expect(rectWithAction(field, { y: 500, height: 56 }, 300, 16)).toEqual({ y: 500, height: 148 });
  });

  it('fits exactly at viewport minus both margins', () => {
    // 600..868 = 268 = 300 - 2 * 16.
    expect(rectWithAction(field, { y: 812, height: 56 }, 300, 16)).toEqual({
      y: 600,
      height: 268,
    });
  });

  it('one point over the room: the field wins', () => {
    expect(rectWithAction(field, { y: 813, height: 56 }, 300, 16)).toEqual(field);
  });

  it('keeps a whole KeepInView group with the button when they fit', () => {
    const group = { y: 580, height: 100 };
    expect(rectWithAction(group, { y: 700, height: 56 }, 300, 16)).toEqual({
      y: 580,
      height: 176,
    });
  });

  it('a button inside the kept rect changes nothing', () => {
    const group = { y: 580, height: 200 };
    expect(rectWithAction(group, { y: 700, height: 56 }, 300, 16)).toEqual(group);
  });
});

describe('KeepInView resize registry (MOB-86)', () => {
  it('notifies listeners until they unsubscribe', () => {
    const groups = createKeepInViewGroups();
    const listener = jest.fn();
    const off = groups.onResized(listener);
    groups.notifyResized();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    groups.notifyResized();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
