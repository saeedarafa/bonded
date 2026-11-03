import { fireEvent, screen, within } from '@testing-library/react-native';
import { Keyboard, Platform, TextInput } from 'react-native';

import { DailyFrame, keyboardBehavior } from '@/features/daily/components/DailyFrame';
import { Button, isCramped, scrollTargetForField } from '@/ui';
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

  it('Android: the window resizes itself, so no extra padding; drags still close it', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderFrame();
    expect(keyboardBehavior('android').behavior).toBeUndefined();
    expect(screen.getByTestId('19-screen-scroll').props.keyboardDismissMode).toBe('on-drag');
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
