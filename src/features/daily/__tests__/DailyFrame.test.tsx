import { fireEvent, screen, within } from '@testing-library/react-native';
import { Keyboard, Platform, TextInput } from 'react-native';

import { DailyFrame, keyboardBehavior } from '@/features/daily/components/DailyFrame';
import { Button } from '@/ui';
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
