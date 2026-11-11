import { fireEvent, screen } from '@testing-library/react-native';
import type * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';

import { KeyDatesScreen } from '@/features/keyDates/screens/KeyDatesScreen';
import { useOnboarding } from '@/features/onboarding/store';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
let mockStatus = 'signedOut';
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ status: mockStatus, userId: mockStatus === 'signedIn' ? 'u1' : null }),
}));

function typeDate(testID: string, year: string, month: string, day: string) {
  return (async () => {
    await fireEvent.changeText(screen.getByTestId(`${testID}-month`), month);
    await fireEvent.changeText(screen.getByTestId(`${testID}-day`), day);
    await fireEvent.changeText(screen.getByTestId(`${testID}-year`), year);
  })();
}

// The screen validates against the real "today"; these dates are safely in the past or future.
const FUTURE_YEAR = String(new Date().getFullYear() + 1);

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = 'signedOut';
  const s = useOnboarding.getState();
  s.reset();
  s.setNames({ displayName: 'Maya', partnerName: 'Sam' });
});

describe('47 Key dates', () => {
  it('shows the board: title, together since, anniversary, my birthday, the partner adds theirs', async () => {
    await renderUi(<KeyDatesScreen />);
    expect(screen.getByRole('header', { name: 'Any dates worth celebrating?' })).toBeTruthy();
    // D50: the quiz ends with 06 (4 of 4); 47 sits after it without progress.
    expect(screen.queryByTestId('47-progress')).toBeNull();
    expect(screen.getByTestId('47-top-back')).toBeTruthy();
    expect(screen.getByText('Together since')).toBeTruthy();
    expect(screen.getByLabelText('Together since, month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anniversary, Add date' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Maya's birthday, Add date" })).toBeTruthy();
    expect(screen.getByLabelText("Sam's birthday, Sam adds it")).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Remind us a week before/ })).toBeTruthy();
    expect(screen.getByTestId('47-remind').props.accessibilityState).toEqual({ checked: true });
  });

  it('never lets me set the partner birthday: the row has no field and no action', async () => {
    await renderUi(<KeyDatesScreen />);
    const row = screen.getByTestId('47-partner-birthday');
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.onPress).toBeUndefined();
    await fireEvent.press(row);
    expect(screen.queryByTestId('47-partner-birthday-field')).toBeNull();
    expect(screen.queryByLabelText(/Sam's birthday, month/)).toBeNull();
  });

  it('Skip drops anything typed and goes on to T1 (MOB-61)', async () => {
    useOnboarding.getState().setKeyDates({ anniversary: '2024-06-01' }, false);
    await renderUi(<KeyDatesScreen />);
    await typeDate('47-together', '2023', '03', '14');
    await fireEvent.press(screen.getByTestId('47-skip'));
    expect(mockRouter.push).toHaveBeenCalledWith('/plan/first-question');
    expect(useOnboarding.getState()).toMatchObject({ keyDates: {}, remindWeekBefore: true });
  });

  it('Continue with nothing typed is the same as skipping', async () => {
    await renderUi(<KeyDatesScreen />);
    await fireEvent.press(screen.getByTestId('47-next'));
    expect(mockRouter.push).toHaveBeenCalledWith('/plan/first-question');
    expect(useOnboarding.getState().keyDates).toEqual({});
  });

  it('keeps valid dates (my birthday only) and the reminder choice locally until sign-in', async () => {
    await renderUi(<KeyDatesScreen />);
    await typeDate('47-together', '2023', '3', '14');
    await fireEvent.press(screen.getByTestId('47-anniversary'));
    await typeDate('47-anniversary-field', '2024', '6', '1');
    await fireEvent.press(screen.getByTestId('47-birthday'));
    await typeDate('47-birthday-field', '1990', '05', '09');
    expect(screen.getByRole('button', { name: "Maya's birthday, May 9" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anniversary, Jun 1' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('47-remind'));
    await fireEvent.press(screen.getByTestId('47-next'));
    expect(mockRouter.push).toHaveBeenCalledWith('/plan/first-question');
    expect(useOnboarding.getState()).toMatchObject({
      keyDates: { together_since: '2023-03-14', anniversary: '2024-06-01', birthday: '1990-05-09' },
      remindWeekBefore: false,
    });
  });

  it.each([
    [
      'an impossible day',
      '2023',
      '2',
      '30',
      "That date doesn't exist. Check the month, day and year.",
    ],
    ['a missing part', '2023', '3', '', 'Add the month, day and year, or leave it empty.'],
    ['a future date', FUTURE_YEAR, '1', '1', "That date hasn't happened yet."],
  ])('explains %s and stays', async (_name, y, m, d, message) => {
    await renderUi(<KeyDatesScreen />);
    await typeDate('47-together', y, m, d);
    await fireEvent.press(screen.getByTestId('47-next'));
    expect(screen.getByTestId('47-together-error')).toHaveTextContent(message);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(useOnboarding.getState().keyDates).toEqual({});
  });

  it('opens a closed row that has an error, and clears the error once fixed', async () => {
    await renderUi(<KeyDatesScreen />);
    await fireEvent.press(screen.getByTestId('47-birthday'));
    await typeDate('47-birthday-field', '1990', '4', '31');
    await fireEvent.press(screen.getByTestId('47-birthday'));
    expect(screen.queryByTestId('47-birthday-field')).toBeNull();
    await fireEvent.press(screen.getByTestId('47-next'));
    expect(screen.getByTestId('47-birthday-field-error')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('47-birthday-field-day'), '30');
    expect(screen.queryByTestId('47-birthday-field-error')).toBeNull();
    await fireEvent.press(screen.getByTestId('47-next'));
    expect(useOnboarding.getState().keyDates).toEqual({ birthday: '1990-04-30' });
  });

  it('only keeps digits in a date part', async () => {
    await renderUi(<KeyDatesScreen />);
    await fireEvent.changeText(screen.getByTestId('47-together-year'), '20a23x');
    expect(screen.getByTestId('47-together-year').props.value).toBe('2023');
  });

  it('signed in already (back from the invite step): Continue returns to the front door', async () => {
    mockStatus = 'signedIn';
    await renderUi(<KeyDatesScreen />);
    await fireEvent.press(screen.getByTestId('47-next'));
    expect(mockRouter.push).toHaveBeenCalledWith('/');
  });

  it('falls back to neutral labels without names', async () => {
    useOnboarding.getState().setNames({ displayName: '', partnerName: '' });
    await renderUi(<KeyDatesScreen />);
    expect(screen.getByRole('button', { name: 'Your birthday, Add date' })).toBeTruthy();
    expect(screen.getByLabelText("Your partner's birthday, They add it")).toBeTruthy();
  });

  it.each(['light', 'dark'] as const)(
    'renders in %s at 200%% text without truncating',
    async (scheme) => {
      await renderUi(<KeyDatesScreen />, { scheme, fontScale: 2 });
      await fireEvent.press(screen.getByTestId('47-birthday'));
      const texts = screen.queryAllByText(/./);
      expect(texts.length).toBeGreaterThan(8);
      expect(texts.filter((node) => node.props.numberOfLines !== undefined)).toEqual([]);
    },
  );

  // #106: at AX2 the partner-birthday label broke one letter per line beside its value.
  describe('rows at accessibility text sizes (#106)', () => {
    afterEach(() => jest.restoreAllMocks());

    function osTextScale(fontScale: number) {
      // The module object itself (an `import * as` copy would not reach the screen).
      const rn = jest.requireActual<typeof ReactNative>('react-native');
      jest
        .spyOn(rn, 'useWindowDimensions')
        .mockReturnValue({ width: 440, height: 956, scale: 3, fontScale });
    }

    it('default size: the value sits beside the label and may shrink and wrap', async () => {
      osTextScale(1);
      useOnboarding.getState().setNames({ displayName: 'Maya', partnerName: 'Alexandria' });
      await renderUi(<KeyDatesScreen />);
      for (const id of ['47-anniversary', '47-birthday', '47-partner-birthday']) {
        expect(screen.getByTestId(`${id}-row`)).toBeTruthy();
        expect(screen.queryByTestId(`${id}-row-stacked`)).toBeNull();
        const value = StyleSheet.flatten(screen.getByTestId(`${id}-value`).props.style);
        expect(value).toMatchObject({ flexShrink: 1, textAlign: 'right' });
      }
    });

    it.each([1.5, 2, 3.1])('at %sx the value moves under the label', async (scale) => {
      osTextScale(scale);
      useOnboarding.getState().setNames({ displayName: 'Maya', partnerName: 'Alexandria' });
      await renderUi(<KeyDatesScreen />, { fontScale: Math.min(scale, 2) });
      for (const id of ['47-anniversary', '47-birthday', '47-partner-birthday']) {
        const row = screen.getByTestId(`${id}-row-stacked`);
        expect(screen.queryByTestId(`${id}-row`)).toBeNull();
        const value = screen.getByTestId(`${id}-value`);
        expect(StyleSheet.flatten(value.props.style)).toMatchObject({ textAlign: 'left' });
        // The value is no longer in the label's line: it's the row's second child.
        expect(row.children).toHaveLength(2);
      }
      expect(screen.getByText('Alexandria adds it')).toBeTruthy();
      expect(screen.getByLabelText("Alexandria's birthday, Alexandria adds it")).toBeTruthy();
    });
  });

  it('every control is at least 44 pt tall', async () => {
    await renderUi(<KeyDatesScreen />);
    for (const role of ['button', 'switch'] as const) {
      for (const node of screen.getAllByRole(role)) {
        const style = StyleSheet.flatten(node.props.style) ?? {};
        expect(style.minHeight ?? style.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
