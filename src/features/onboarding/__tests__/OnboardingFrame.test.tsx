import { fireEvent, screen, within } from '@testing-library/react-native';
import { Keyboard, TextInput } from 'react-native';

import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { Button } from '@/ui';
import { renderUi } from '@/test/render';

// #66: on an iPhone SE the keyboard covered 07's Continue and a tap outside did not close it.
describe('OnboardingFrame keyboard and small screens (#66)', () => {
  afterEach(() => jest.restoreAllMocks());

  async function renderFrame(cramped?: boolean) {
    const onNext = jest.fn();
    await renderUi(
      <OnboardingFrame
        screenId="07"
        step={{ n: 5, total: 6 }}
        onBack={jest.fn()}
        footer={<Button testID="07-next" label="Continue" onPress={onNext} />}
      >
        <TextInput testID="07-me" />
      </OnboardingFrame>,
      cramped === undefined ? {} : { cramped },
    );
    return onNext;
  }

  it('Continue sits inside the keyboard-avoiding view, so it rides above the keyboard', async () => {
    await renderFrame(false);
    expect(within(screen.getByTestId('07-keyboard')).getByTestId('07-next')).toBeTruthy();
    expect(within(screen.getByTestId('07-keyboard')).getByTestId('07-me')).toBeTruthy();
  });

  it('a tap outside the fields closes the keyboard; Continue still works', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    const onNext = await renderFrame(false);
    const area = screen.getByTestId('07-dismiss');
    expect(area.props.accessible).toBe(false);
    await fireEvent.press(area);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('07-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('cramped: Continue scrolls with the names; otherwise it is pinned below the scroll', async () => {
    await renderFrame(true);
    expect(within(screen.getByTestId('07-scroll')).getByTestId('07-next')).toBeTruthy();
    screen.unmount();
    await renderFrame(false);
    expect(within(screen.getByTestId('07-scroll')).queryByTestId('07-next')).toBeNull();
  });
});
