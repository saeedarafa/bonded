import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet } from 'react-native';

import { renderUi } from '@/test/render';

import { BadgeLadder, badgeStates, BADGE_STEPS, nextBadgeStep } from '../BadgeLadder';
import { Heatmap, type HeatDay } from '../Heatmap';
import { HOLD_MS, HoldToReveal } from '../HoldToReveal';
import { ProgressBar } from '../ProgressBar';

const mockedHaptics = Haptics as jest.Mocked<typeof Haptics>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('HoldToReveal', () => {
  it('keeps a wrapped label centred under the ring at 200% text (#109)', async () => {
    await renderUi(
      <HoldToReveal
        testID="20-hold"
        label="Hold to reveal Alexandria's answer"
        onComplete={jest.fn()}
      />,
      { fontScale: 2 },
    );
    const label = screen.getByTestId('20-hold-label', { includeHiddenElements: true });
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ textAlign: 'center' });
    expect(label.props.numberOfLines).toBeUndefined();
  });

  it('completes after 1.2 s of holding, with selection ticks then a success haptic', async () => {
    const onComplete = jest.fn();
    await renderUi(<HoldToReveal onComplete={onComplete} />);
    const control = screen.getByRole('button', { name: 'Hold to reveal' });
    await fireEvent(control, 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS - 1);
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(mockedHaptics.selectionAsync).toHaveBeenCalledTimes(3);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockedHaptics.notificationAsync).toHaveBeenCalledWith('success');
    // Letting go afterwards, or holding again, never fires twice.
    await fireEvent(control, 'pressOut');
    await fireEvent(control, 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS * 2);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('resets when released early', async () => {
    const onComplete = jest.fn();
    await renderUi(<HoldToReveal onComplete={onComplete} />);
    const control = screen.getByRole('button', { name: 'Hold to reveal' });
    await fireEvent(control, 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    await fireEvent(control, 'pressOut');
    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS * 2);
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(mockedHaptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('lets a screen reader complete it with the activate action', async () => {
    const onComplete = jest.fn();
    await renderUi(<HoldToReveal onComplete={onComplete} />);
    const control = screen.getByRole('button', { name: 'Hold to reveal' });
    expect(control.props.accessibilityActions).toEqual([{ name: 'activate' }]);
    await fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('with reduced motion is a tap with a confirmation, and holding does nothing', async () => {
    const onComplete = jest.fn();
    await renderUi(<HoldToReveal onComplete={onComplete} />, { reducedMotion: true });
    const tapFirst = screen.getByRole('button', { name: 'Tap to reveal' });
    await fireEvent(tapFirst, 'pressIn');
    await act(async () => {
      jest.advanceTimersByTime(HOLD_MS * 2);
    });
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.press(tapFirst);
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Tap again to reveal' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('BadgeLadder', () => {
  it('uses the DESIGN.md steps', () => {
    expect([...BADGE_STEPS]).toEqual([1, 3, 7, 14, 21, 30, 50, 100, 365]);
  });

  it('marks earned, next (with progress) and locked', () => {
    const states = badgeStates(10);
    expect(states.filter((s) => s.state === 'earned').map((s) => s.days)).toEqual([1, 3, 7]);
    const next = states.find((s) => s.state === 'next');
    expect(next?.days).toBe(14);
    expect(next?.progress).toBeCloseTo(10 / 14);
    expect(states.filter((s) => s.state === 'locked').map((s) => s.days)).toEqual([
      21, 30, 50, 100, 365,
    ]);
  });

  it('handles day 0 and a streak past the last step', () => {
    expect(badgeStates(0)[0]).toEqual({ days: 1, state: 'next', progress: 0 });
    expect(badgeStates(400).every((s) => s.state === 'earned')).toBe(true);
  });

  it('takes earned steps from awards, not from the streak (MOB-17)', () => {
    // Awards are permanent: a broken streak keeps 1, 3 and 7; the next is above the streak.
    const states = badgeStates(2, BADGE_STEPS, [1, 3, 7]);
    expect(states.filter((s) => s.state === 'earned').map((s) => s.days)).toEqual([1, 3, 7]);
    expect(states.find((s) => s.state === 'next')).toEqual({
      days: 14,
      state: 'next',
      progress: 2 / 14,
    });
    // No award yet for a step the streak already passed: it stays locked, never "next".
    expect(badgeStates(4, BADGE_STEPS, []).find((s) => s.state === 'next')?.days).toBe(7);
    expect(nextBadgeStep(400, BADGE_STEPS, [...BADGE_STEPS])).toBeUndefined();
  });

  it('labels every step for screen readers', async () => {
    await renderUi(<BadgeLadder current={12} />);
    expect(screen.getByLabelText('7-day badge, earned')).toBeTruthy();
    expect(screen.getByLabelText('14-day badge, next, 86 percent')).toBeTruthy();
    expect(screen.getByLabelText('365-day badge, locked')).toBeTruthy();
  });
});

describe('Heatmap and ProgressBar', () => {
  const days: HeatDay[] = [
    { key: 'pad', day: 0, state: 'empty' },
    { key: 'a', day: 1, state: 'both' },
    { key: 'b', day: 2, state: 'one' },
    { key: 'c', day: 3, state: 'missed' },
    { key: 'd', day: 4, state: 'today' },
  ];

  it('is one labelled element with a number in every filled cell', async () => {
    await renderUi(<Heatmap days={days} label="October: 3 of 4 days" testID="heat" />);
    expect(screen.getByLabelText('October: 3 of 4 days')).toBeTruthy();
    for (const n of ['1', '2', '3', '4']) expect(screen.getByText(n)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('ProgressBar exposes its value', async () => {
    await renderUi(<ProgressBar value={0.6} label="Step 3 of 5" />);
    const bar = screen.getByRole('progressbar', { name: 'Step 3 of 5' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 60 });
  });

  it('ProgressBar clamps out-of-range values', async () => {
    await renderUi(<ProgressBar value={4} label="Done" />);
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(100);
  });
});
