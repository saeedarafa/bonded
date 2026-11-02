import { fireEvent, screen } from '@testing-library/react-native';

import { renderUi } from '@/test/render';

import { Button } from '../Button';

describe('Button', () => {
  it('presses, with a button role and label', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Answer" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Answer' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('has no disabled state: loading stays pressable but ignores presses', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Sending" loading onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Sending' });
    expect(button.props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    expect(button.props.accessibilityState.disabled).toBeFalsy();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('button-spinner')).toBeTruthy();
  });
});
