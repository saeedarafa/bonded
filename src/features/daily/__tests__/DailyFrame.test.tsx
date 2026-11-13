import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { DeviceEventEmitter, Keyboard, Platform, StyleSheet, TextInput } from 'react-native';

import { DailyFrame, keyboardBehavior } from '@/features/daily/components/DailyFrame';
import {
  Button,
  isCramped,
  KeepInView,
  KeepInViewProvider,
  rectToKeepInView,
  scrollTargetForField,
  TITLE_MAX_FONT_SCALE,
  type KeepInViewGroups,
} from '@/ui';
import { renderUi } from '@/test/render';

// #32: on an iPhone SE the keyboard covered "Lock in" and could not be closed.
describe('DailyFrame keyboard handling (#32)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function renderFrame() {
    const onLock = jest.fn();
    await renderUi(
      <DailyFrame
        testID="19-screen"
        onBack={jest.fn()}
        footer={<Button testID="19-submit" label="Lock in" onPress={onLock} />}
      >
        <TextInput testID="19-input" />
      </DailyFrame>,
    );
    return onLock;
  }

  it('iOS: body and pinned action sit in a padding KeyboardAvoidingView', async () => {
    await renderFrame();
    expect(keyboardBehavior('ios').behavior).toBe('padding');
    const avoider = screen.getByTestId('19-screen-keyboard');
    const inside = within(avoider);
    expect(inside.getByTestId('19-screen-scroll')).toBeTruthy();
    expect(inside.getByTestId('19-submit')).toBeTruthy();
    expect(inside.getByTestId('19-input')).toBeTruthy();
  });

  it('a drag closes the keyboard; taps on buttons still go through', async () => {
    const onLock = await renderFrame();
    const scroll = screen.getByTestId('19-screen-scroll');
    expect(scroll.props.keyboardDismissMode).toBe('interactive');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('a tap outside the field closes the keyboard, without a screen-reader stop', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    await renderFrame();
    const area = screen.getByTestId('19-screen-dismiss');
    expect(area.props.accessible).toBe(false);
    await fireEvent.press(area);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('Android: a drag closes the keyboard', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderFrame();
    expect(screen.getByTestId('19-screen-scroll').props.keyboardDismissMode).toBe('on-drag');
  });

  // #264: edge-to-edge (Android 15+) ignores adjustResize, so the view pads itself as on iOS.
  it('keyboardBehavior pads above the keyboard on both platforms; only the drag differs', () => {
    expect(keyboardBehavior('ios')).toEqual({ behavior: 'padding', dismissMode: 'interactive' });
    expect(keyboardBehavior('android')).toEqual({ behavior: 'padding', dismissMode: 'on-drag' });
  });

  it('Android edge-to-edge: the pinned action rises by the keyboard overlap, and drops back', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderFrame();
    const avoider = screen.getByTestId('19-screen-keyboard');
    // The frame ends at 800 (the window does not shrink); the keyboard top is at 500.
    await act(() =>
      fireEvent(avoider, 'layout', {
        persist: () => undefined,
        nativeEvent: { layout: { x: 0, y: 100, width: 400, height: 700 } },
      }),
    );
    expect(
      StyleSheet.flatten(screen.getByTestId('19-screen-keyboard').props.style).paddingBottom,
    ).toBe(0);
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidShow', {
        endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 },
      });
      await Promise.resolve();
    });
    expect(
      StyleSheet.flatten(screen.getByTestId('19-screen-keyboard').props.style).paddingBottom,
    ).toBe(300);
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidHide', null);
      await Promise.resolve();
    });
    expect(
      StyleSheet.flatten(screen.getByTestId('19-screen-keyboard').props.style).paddingBottom,
    ).toBe(0);
  });

  it('Android where the window still resizes: the frame ends at the keyboard, no double padding', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderFrame();
    const avoider = screen.getByTestId('19-screen-keyboard');
    await act(async () => {
      DeviceEventEmitter.emit('keyboardDidShow', {
        endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 },
      });
      await Promise.resolve();
    });
    await act(() =>
      fireEvent(avoider, 'layout', {
        persist: () => undefined,
        nativeEvent: { layout: { x: 0, y: 100, width: 400, height: 400 } },
      }),
    );
    expect(
      StyleSheet.flatten(screen.getByTestId('19-screen-keyboard').props.style).paddingBottom,
    ).toBe(0);
  });
});

describe('small screens at large text (#65)', () => {
  async function renderFrame(cramped: boolean) {
    await renderUi(
      <DailyFrame
        testID="J7-screen"
        onBack={jest.fn()}
        footer={<Button testID="J7-submit" label="Lock in" onPress={jest.fn()} />}
      >
        <TextInput testID="J7-input" />
      </DailyFrame>,
      { cramped },
    );
  }

  it('cramped (iPhone SE at 200%): the action scrolls with the body, under the field', async () => {
    await renderFrame(true);
    expect(within(screen.getByTestId('J7-screen-scroll')).getByTestId('J7-submit')).toBeTruthy();
  });

  it('otherwise the action stays pinned under the scrolling body', async () => {
    await renderFrame(false);
    expect(within(screen.getByTestId('J7-screen-scroll')).queryByTestId('J7-submit')).toBeNull();
    expect(screen.getByTestId('J7-submit')).toBeTruthy();
  });

  it('the scroll view tracks its viewport and offset to follow the focused field', async () => {
    await renderFrame(false);
    const scroll = screen.getByTestId('J7-screen-scroll');
    expect(typeof scroll.props.onLayout).toBe('function');
    expect(typeof scroll.props.onScroll).toBe('function');
  });

  it.each([
    ['iPhone SE, 100%', 667, 1, false],
    ['iPhone SE, 200% (AX2)', 667, 2, true],
    ['iPhone SE, 135%', 667, 1.35, false],
    ['iPhone 16 Pro Max, 200%', 932, 2, false],
    ['iPhone 16 Pro Max, AX5 (~310%)', 932, 3.12, true],
  ])('isCramped: %s -> %s', (_name, height, scale, expected) => {
    expect(isCramped(height, scale)).toBe(expected);
  });
});

describe('the title at large text (#84)', () => {
  async function renderTitled(cramped: boolean) {
    await renderUi(
      <DailyFrame
        testID="19-screen"
        onBack={jest.fn()}
        title="Today's question"
        footer={<Button testID="19-submit" label="Lock in" onPress={jest.fn()} />}
      >
        <TextInput testID="19-input" />
      </DailyFrame>,
      { cramped },
    );
  }

  it('pinned title stops growing at 200%, so its words fit and never break mid-word', async () => {
    await renderTitled(false);
    expect(TITLE_MAX_FONT_SCALE).toBe(2);
    const title = screen.getByTestId('19-screen-top-title');
    expect(title.props.maxFontSizeMultiplier).toBe(2);
    expect(title.props.numberOfLines).toBeUndefined();
    expect(
      within(screen.getByTestId('19-screen-scroll')).queryByText("Today's question"),
    ).toBeNull();
  });

  it('cramped (SE at AX5): the title scrolls with the body; only the back button stays pinned', async () => {
    await renderTitled(true);
    expect(screen.queryByTestId('19-screen-top-title')).toBeNull();
    expect(screen.getByTestId('19-screen-top-back')).toBeTruthy();
    const title = within(screen.getByTestId('19-screen-scroll')).getByTestId('19-screen-title');
    expect(title.props.maxFontSizeMultiplier).toBe(2);
    expect(title.props.accessibilityRole).toBe('header');
    expect(screen.getAllByText("Today's question")).toHaveLength(1);
  });
});

describe('scrollTargetForField (#65)', () => {
  const base = { viewportHeight: 259, scrollY: 0, margin: 12 };

  it('J7 on an SE: a field below the visible body scrolls up until its bottom shows', () => {
    // Body visible y 76-335 (259 pt); the field sat at 317-405, i.e. 241-329 in the content.
    expect(scrollTargetForField({ ...base, fieldY: 241, fieldHeight: 88 })).toBe(82);
  });

  it('a field already in view does not move', () => {
    expect(scrollTargetForField({ ...base, fieldY: 40, fieldHeight: 88 })).toBeNull();
  });

  it('a field scrolled above the view comes back down to its top', () => {
    expect(scrollTargetForField({ ...base, scrollY: 300, fieldY: 200, fieldHeight: 60 })).toBe(188);
  });

  it('a field taller than the view shows its bottom, where the caret is', () => {
    expect(scrollTargetForField({ ...base, fieldY: 100, fieldHeight: 400 })).toBe(253);
  });
});

describe('KeepInView (#85)', () => {
  const viewport = 259;
  const margin = 12;
  // J7 on an SE: field 233-321, counter to 346, privacy line to 374 (content coordinates).
  const field = { y: 157, height: 88 };
  const group = { y: 157, height: 141 };

  it('keeps the whole group (field + counter + privacy line) when it fits', () => {
    expect(rectToKeepInView(field, [group], viewport, margin)).toEqual(group);
    // ...so the scroll goes far enough to show the privacy line, not just the field.
    expect(
      scrollTargetForField({
        fieldY: group.y,
        fieldHeight: group.height,
        viewportHeight: viewport,
        scrollY: 0,
        margin,
      }),
    ).toBe(51);
  });

  // #108: J7 at 200% with the keyboard: the two-line "Lock in and reveal Sam's" button leaves a
  // viewport shorter than field + counter + privacy line; the privacy line must still show.
  it('a group taller than the view keeps its bottom: the end of the field and the privacy line', () => {
    const small = 140;
    const kept = rectToKeepInView(field, [group], small, margin);
    expect(kept).toEqual({ y: group.y + group.height - (small - 2 * margin), height: 116 });
    // The privacy line (the group's end) and the field's last line are inside the kept rect.
    expect(kept.y + kept.height).toBe(group.y + group.height);
    expect(kept.y).toBeLessThan(field.y + field.height - margin);
    expect(
      scrollTargetForField({
        fieldY: kept.y,
        fieldHeight: kept.height,
        viewportHeight: small,
        scrollY: 0,
        margin,
      }),
    ).toBe(group.y + group.height + margin - small);
  });

  it('falls back to the field when the group is taller than the view (the caret wins)', () => {
    expect(rectToKeepInView(field, [{ y: 100, height: 400 }], viewport, margin)).toEqual(field);
  });

  it('ignores groups that do not hold the focused field', () => {
    expect(rectToKeepInView(field, [{ y: 400, height: 80 }], viewport, margin)).toEqual(field);
    expect(rectToKeepInView(field, [], viewport, margin)).toEqual(field);
  });

  it('registers with the frame while mounted and leaves on unmount', async () => {
    const groups: KeepInViewGroups = { views: new Set(), resized: { current: null } };
    const r = await renderUi(
      <KeepInViewProvider value={groups}>
        <KeepInView testID="group">
          <TextInput testID="field" />
        </KeepInView>
      </KeepInViewProvider>,
    );
    expect(groups.views.size).toBe(1);
    await r.unmount();
    expect(groups.views.size).toBe(0);
  });

  it('DailyFrame provides the registry to its body', async () => {
    await renderUi(
      <DailyFrame testID="19-screen" onBack={jest.fn()}>
        <KeepInView testID="19-keep-in-view">
          <TextInput testID="19-input" />
        </KeepInView>
      </DailyFrame>,
    );
    expect(
      within(screen.getByTestId('19-screen-scroll')).getByTestId('19-keep-in-view'),
    ).toBeTruthy();
  });
});
