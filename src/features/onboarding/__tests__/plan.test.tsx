import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { setSoftAskStorage, softAskAnswer } from '@/features/push/softAsk';
import { renderUi } from '@/test/render';
import { memoryStorage } from '@/test/memoryStorage';

import { createPendingSetupStore, usePendingSetup } from '../pendingSetup';
import { RESEARCH } from '../research';
import {
  BUILD_REDUCED_MS,
  BUILD_STEP_MS,
  BUILD_TOTAL_MS,
  BuildingPlanScreen,
} from '../screens/BuildingPlanScreen';
import { DailyMomentScreen } from '../screens/DailyMomentScreen';
import { FirstQuestionScreen } from '../screens/FirstQuestionScreen';
import { YourPlanScreen } from '../screens/YourPlanScreen';
import { useOnboarding } from '../store';
import { stepTime } from '../TimePickerSheet';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
let mockStatus: 'signedIn' | 'signedOut' = 'signedOut';
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ status: mockStatus, userId: mockStatus === 'signedIn' ? 'u1' : null }),
}));

const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = 'signedOut';
  setSoftAskStorage(memoryStorage());
  usePendingSetup.getState().reset();
  const s = useOnboarding.getState();
  s.reset();
  s.setStage('living_together');
  s.toggleGoal('deep_talks');
  s.toggleGoal('laughing');
  s.setNames({ displayName: 'Maya', partnerName: 'Sam' });
});

describe('pending setup on the phone (T1, N)', () => {
  it('the T1 answer and the daily moment survive an app restart until sign-in', () => {
    const disk = memoryStorage();
    const before = createPendingSetupStore(disk);
    before.getState().setFirstAnswer('FIXTURE-T1 your laugh');
    before.getState().setRitual('12:30', 'on');
    // A new launch reads the same encrypted store.
    const after = createPendingSetupStore(disk);
    expect(after.getState()).toMatchObject({
      firstAnswer: { body: 'FIXTURE-T1 your laugh', writtenAt: expect.any(String) },
      ritualTime: '12:30',
      reminders: 'on',
    });
    // Sent and dropped: nothing left for the next launch.
    after.getState().reset();
    expect(disk.data.size).toBe(0);
    expect(createPendingSetupStore(disk).getState().firstAnswer).toBeNull();
  });

  it('ignores a damaged copy instead of failing', () => {
    const disk = memoryStorage();
    disk.setItem('setup', '{"firstAnswer":{"body":""},"ritualTime":"25:99","reminders":"x"}');
    expect(createPendingSetupStore(disk).getState()).toMatchObject({
      firstAnswer: null,
      ritualTime: null,
      reminders: null,
    });
    disk.setItem('setup', 'not json');
    expect(createPendingSetupStore(disk).getState().firstAnswer).toBeNull();
  });
});

describe('T1 first question', () => {
  it('asks the day-1 question about the partner, needs an answer, keeps it and goes to N', async () => {
    await renderUi(<FirstQuestionScreen />);
    expect(screen.getByTestId('T1-question')).toHaveTextContent(
      'What did you notice first about Sam?',
    );
    expect(screen.getByTestId('T1-private')).toHaveTextContent('Private until Sam answers');
    expect(screen.getByTestId('T1-top')).toBeTruthy();
    expect(screen.getByLabelText('Almost there')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('T1-submit'));
    expect(screen.getByTestId('T1-field-error')).toHaveTextContent('Write a few words first.', {
      exact: false,
    });
    expect(mockRouter.push).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('T1-field'), '  FIXTURE-T1 your laugh  ');
    await fireEvent.press(screen.getByTestId('T1-submit'));
    expect(usePendingSetup.getState().firstAnswer?.body).toBe('FIXTURE-T1 your laugh');
    expect(mockRouter.push).toHaveBeenCalledWith('/plan/moment');
  });

  it('shows the kept answer again after a restart; the same text keeps its time', async () => {
    usePendingSetup.getState().setFirstAnswer('FIXTURE-T1 kept');
    const kept = usePendingSetup.getState().firstAnswer;
    await renderUi(<FirstQuestionScreen />);
    expect(screen.getByTestId('T1-field').props.value).toBe('FIXTURE-T1 kept');
    await fireEvent.press(screen.getByTestId('T1-submit'));
    expect(usePendingSetup.getState().firstAnswer).toBe(kept);
  });

  it('no partner name reads "your partner"', async () => {
    useOnboarding.getState().setNames({ partnerName: '' });
    await renderUi(<FirstQuestionScreen />);
    expect(screen.getByTestId('T1-question')).toHaveTextContent(
      'What did you notice first about your partner?',
    );
  });
});

describe('N daily moment', () => {
  it('21:00 is picked by default; "Not now" keeps the time, remembers the answer and goes on', async () => {
    await renderUi(<DailyMomentScreen />);
    expect(screen.getByRole('radio', { name: '21:00, Evening' })).toBeChecked();
    expect(screen.getByText(/ping you when Sam answers/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('N-time-morning'));
    expect(screen.getByRole('radio', { name: '08:00, Morning' })).toBeChecked();
    await fireEvent.press(screen.getByTestId('N-decline'));
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(softAskAnswer()).toBe('declined');
    expect(usePendingSetup.getState()).toMatchObject({ ritualTime: '08:00', reminders: 'off' });
    expect(mockRouter.push).toHaveBeenCalledWith('/plan/building');
  });

  it('"Turn on reminders" asks the OS; allowed means reminders on', async () => {
    await renderUi(<DailyMomentScreen />);
    await fireEvent.press(screen.getByTestId('N-time-lunch'));
    await fireEvent.press(screen.getByTestId('N-accept'));
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(softAskAnswer()).toBe('accepted');
    expect(usePendingSetup.getState()).toMatchObject({ ritualTime: '12:30', reminders: 'on' });
    expect(mockRouter.push).toHaveBeenCalledWith('/plan/building');
  });

  it('declined at the OS prompt: the time is still kept and L will say "Daily moment set"', async () => {
    requestPermissions.mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    });
    await renderUi(<DailyMomentScreen />);
    await fireEvent.press(screen.getByTestId('N-accept'));
    expect(usePendingSetup.getState()).toMatchObject({ ritualTime: '21:00', reminders: 'off' });
    expect(mockRouter.push).toHaveBeenCalledWith('/plan/building');
  });

  it('"Pick another time" sets any time (other), shown as its own picked row', async () => {
    await renderUi(<DailyMomentScreen />);
    await fireEvent.press(screen.getByTestId('N-other'));
    expect(screen.getByTestId('N-picker')).toBeTruthy();
    // From 21:00: one hour earlier, then 45 minutes later in 5-minute steps.
    await fireEvent.press(screen.getByTestId('N-picker-hour-down'));
    for (let i = 0; i < 9; i += 1) await fireEvent.press(screen.getByTestId('N-picker-minute-up'));
    expect(screen.getByTestId('N-picker-hour-value')).toHaveTextContent('20');
    expect(screen.getByTestId('N-picker-minute-value')).toHaveTextContent('45');
    expect(screen.getByRole('adjustable', { name: 'Hour' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('N-picker-use'));
    expect(screen.queryByTestId('N-picker')).toBeNull();
    expect(screen.getByTestId('N-time-other')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Your time. 20:45' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '21:00, Evening' })).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('N-decline'));
    expect(usePendingSetup.getState().ritualTime).toBe('20:45');
  });

  it('the picker wraps around midnight and the hour', () => {
    expect(stepTime({ hour: 23, minute: 0 }, 'hour', 1)).toEqual({ hour: 0, minute: 0 });
    expect(stepTime({ hour: 0, minute: 0 }, 'minute', -1)).toEqual({ hour: 0, minute: 55 });
    expect(stepTime({ hour: 8, minute: 55 }, 'minute', 1)).toEqual({ hour: 8, minute: 0 });
  });

  it('a kept other time opens as "Your time"', async () => {
    usePendingSetup.getState().setRitual('06:15', 'off');
    await renderUi(<DailyMomentScreen />);
    expect(screen.getByRole('radio', { name: 'Your time. 06:15' })).toBeChecked();
  });
});

describe('L building your plan', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('ticks the four lines in about 4 s, then replaces itself with P2', async () => {
    usePendingSetup.getState().setRitual('12:30', 'on');
    await renderUi(<BuildingPlanScreen />);
    expect(screen.getByTestId('L-title')).toHaveTextContent('Building Maya & Sam’s plan');
    const lines = [0, 1, 2, 3].map((i) => screen.getByTestId(`L-step-${i}`));
    expect(lines[0]).toHaveTextContent('Questions picked for living together');
    expect(lines[1]).toHaveTextContent('Deep talks and laughs added');
    expect(lines[2]).toHaveTextContent('Reminders set for 12:30');
    expect(lines[3]).toHaveTextContent('Your first week planned');
    expect(screen.getByTestId('L-closer')).toHaveTextContent(
      'Closer by design. Your questions use proven relationship psychology, so every answer brings you nearer to Sam.',
    );
    expect(screen.getByTestId('L-step-0-current')).toBeTruthy();

    await act(() => jest.advanceTimersByTime(BUILD_STEP_MS - 1));
    expect(screen.queryByTestId('L-step-0-done')).toBeNull();
    await act(() => jest.advanceTimersByTime(1));
    expect(screen.getByTestId('L-step-0-done')).toBeTruthy();
    expect(screen.getByLabelText('Questions picked for living together, done')).toBeTruthy();
    expect(screen.getByTestId('L-step-1-current')).toBeTruthy();

    await act(() => jest.advanceTimersByTime(BUILD_STEP_MS * 3));
    expect(screen.getByTestId('L-step-3-done')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(BUILD_TOTAL_MS - BUILD_STEP_MS * 4));
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/plan/yours');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('declined reminders read "Daily moment set for <time>"', async () => {
    usePendingSetup.getState().setRitual('21:00', 'off');
    await renderUi(<BuildingPlanScreen />);
    expect(screen.getByTestId('L-step-2')).toHaveTextContent('Daily moment set for 21:00');
  });

  it('follows the stage and goals; no names, stage or goals still reads well', async () => {
    useOnboarding.getState().reset();
    useOnboarding.getState().toggleGoal('romance');
    await renderUi(<BuildingPlanScreen />);
    expect(screen.getByTestId('L-title')).toHaveTextContent('Building your plan');
    expect(screen.getByTestId('L-step-0')).toHaveTextContent('Questions picked for you two');
    expect(screen.getByTestId('L-step-1')).toHaveTextContent('Romance added');
    // N never answered (opened directly): the server default time.
    expect(screen.getByTestId('L-step-2')).toHaveTextContent('Daily moment set for 21:00');
    useOnboarding.getState().reset();
    useOnboarding.getState().setStage('long_distance');
    await renderUi(<BuildingPlanScreen />);
    expect(screen.getByTestId('L-step-0')).toHaveTextContent('Questions picked for long-distance');
    expect(screen.getByTestId('L-step-1')).toHaveTextContent('A mix of topics added');
  });

  it('reduced motion: every line done at once, P2 after a short pause', async () => {
    await renderUi(<BuildingPlanScreen />, { reducedMotion: true });
    for (const i of [0, 1, 2, 3]) expect(screen.getByTestId(`L-step-${i}-done`)).toBeTruthy();
    expect(screen.getByLabelText('Building your plan').props.accessibilityValue).toMatchObject({
      now: 100,
    });
    await act(() => jest.advanceTimersByTime(BUILD_REDUCED_MS - 1));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(mockRouter.replace).toHaveBeenCalledWith('/plan/yours');
  });

  it('leaving early (Back) stops the clock', async () => {
    const view = await renderUi(<BuildingPlanScreen />);
    await view.unmount();
    await act(() => jest.advanceTimersByTime(BUILD_TOTAL_MS * 2));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('P2 your plan', () => {
  it('reads the chart as one image with both values and the source', async () => {
    await renderUi(<YourPlanScreen />);
    expect(screen.getByTestId('P2-title')).toHaveTextContent(
      'Small daily moments keep couples close',
    );
    const chart = screen.getByRole('image', {
      name:
        'Bar chart. How often partners turned toward each other’s small moments of attention:. ' +
        'Couples who stayed together: 86 percent. Couples who split up: 33 percent. ' +
        'Source: Gottman & Driver, newlywed couples study',
    });
    expect(chart).toBe(screen.getByTestId('P2-chart'));
    expect(screen.getByTestId('P2-bar-stayed-value')).toHaveTextContent('86%');
    expect(screen.getByTestId('P2-bar-split-value')).toHaveTextContent('33%');
    expect(screen.getByTestId('P2-chart-source')).toHaveTextContent(RESEARCH.turningToward.source);
  });

  it('two findings with their source lines', async () => {
    await renderUi(<YourPlanScreen />);
    expect(screen.getByTestId('P2-finding-personal-source')).toHaveTextContent('Aron et al., 1997');
    expect(screen.getByTestId('P2-finding-warm-source')).toHaveTextContent(
      'Gable et al., 2004 and 2006',
    );
    expect(
      screen.getByLabelText(
        '36. Partners who took turns answering personal questions felt clearly closer afterwards. Source: Aron et al., 1997.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Daily. Warm responses when a partner shares something are linked to happier, longer-lasting relationships. Source: Gable et al., 2004 and 2006.',
      ),
    ).toBeTruthy();
  });

  it('names the couple and the daily moment; "Start our plan" goes to sign-in (AFTER_PLAN)', async () => {
    usePendingSetup.getState().setRitual('08:00', 'on');
    await renderUi(<YourPlanScreen />);
    expect(screen.getByTestId('P2-summary')).toHaveTextContent(
      'Bonded turns this into 3 minutes a day for Maya & Sam, at 08:00.',
    );
    await fireEvent.press(screen.getByTestId('P2-start'));
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-in');
  });

  it('without names or a time: "you two, at 21:00"; signed in already goes to `/`', async () => {
    mockStatus = 'signedIn';
    useOnboarding.getState().setNames({ displayName: '', partnerName: '' });
    await renderUi(<YourPlanScreen />);
    expect(screen.getByTestId('P2-summary')).toHaveTextContent(
      'Bonded turns this into 3 minutes a day for you two, at 21:00.',
    );
    await fireEvent.press(screen.getByTestId('P2-start'));
    expect(mockRouter.push).toHaveBeenCalledWith('/');
  });

  it('back goes to N (L is never returned to)', async () => {
    mockRouter.canGoBack.mockReturnValueOnce(false);
    await renderUi(<YourPlanScreen />);
    await fireEvent.press(screen.getByTestId('P2-top-back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/plan/moment');
  });
});
