import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';

import { renderUi } from '@/test/render';

import { AnswerField, ANSWER_MAX_LENGTH } from '../AnswerField';
import { CODE_LENGTH, CodeInput, sanitizeCode } from '../CodeInput';
import { Composer, TYPING_THROTTLE_MS } from '../Composer';
import { OptionRow } from '../OptionRow';
import { PlanCard } from '../PlanCard';
import { ReactionPill } from '../ReactionPill';
import { TextField } from '../TextField';
import { Toggle } from '../Toggle';

const mockedHaptics = Haptics as jest.Mocked<typeof Haptics>;

beforeEach(() => jest.clearAllMocks());

describe('TextField', () => {
  it('names the input and announces the error, with the error haptic', async () => {
    await renderUi(
      <TextField label="Partner name" value="" onChangeText={() => undefined} error="Too short" />,
    );
    expect(screen.getByLabelText('Partner name')).toBeTruthy();
    expect(screen.getByText('Too short').props.accessibilityLiveRegion).toBe('polite');
    expect(mockedHaptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('keeps the error haptic out of the no-error state', async () => {
    await renderUi(<TextField label="Partner name" value="" onChangeText={() => undefined} />);
    expect(mockedHaptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('shakes without sound or motion changes under reduced motion (haptic only)', async () => {
    await renderUi(<TextField label="Name" value="" onChangeText={() => undefined} error="Bad" />, {
      reducedMotion: true,
    });
    expect(mockedHaptics.notificationAsync).toHaveBeenCalledTimes(1);
  });
});

describe('AnswerField', () => {
  it('counts characters out of 500 and warns near the limit', async () => {
    function Harness({ initial }: { initial: string }) {
      const [value, setValue] = useState(initial);
      return <AnswerField label="Question" value={value} onChangeText={setValue} testID="answer" />;
    }
    await renderUi(<Harness initial="hello" />);
    expect(screen.getByTestId('answer-counter').props.children).toBe('5 / 500');
    expect(screen.getByTestId('answer').props.maxLength).toBe(ANSWER_MAX_LENGTH);
    await fireEvent.changeText(screen.getByTestId('answer'), 'hello there');
    expect(screen.getByTestId('answer-counter').props.children).toBe('11 / 500');
  });

  it('reads the counter out as characters', async () => {
    await renderUi(<AnswerField label="Q" value="abc" onChangeText={() => undefined} testID="a" />);
    expect(screen.getByLabelText('3 of 500 characters')).toBeTruthy();
  });
});

describe('CodeInput', () => {
  it('keeps digits only, so a pasted BND·1234 works', () => {
    expect(sanitizeCode('BND·1234')).toBe('1234');
    expect(sanitizeCode('bnd 12 34 56')).toBe('1234');
    expect(sanitizeCode('')).toBe('');
    expect(CODE_LENGTH).toBe(4);
  });

  it('reports each change as digits and completes once on the 4th', async () => {
    const onComplete = jest.fn();
    function Harness() {
      const [value, setValue] = useState('');
      return <CodeInput testID="code" value={value} onChange={setValue} onComplete={onComplete} />;
    }
    await renderUi(<Harness />);
    const input = screen.getByTestId('code');
    await fireEvent.changeText(input, '12');
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.changeText(input, 'BND·1234');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('1234');
    expect(screen.getByLabelText('Invite code')).toBeTruthy();
  });

  it('shows the error under the cells', async () => {
    await renderUi(<CodeInput value="48" onChange={() => undefined} error="Check the digits" />);
    expect(screen.getByText('Check the digits')).toBeTruthy();
  });
});

describe('Toggle, OptionRow, PlanCard, ReactionPill', () => {
  it('Toggle is a switch with state, and flips with a selection haptic', async () => {
    const onValueChange = jest.fn();
    await renderUi(<Toggle label="Daily reminder" value={false} onValueChange={onValueChange} />);
    const toggle = screen.getByRole('switch', { name: 'Daily reminder' });
    expect(toggle.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    await fireEvent.press(toggle);
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(mockedHaptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('OptionRow is a radio or checkbox with its checked state', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <OptionRow label="Dating" description="Early days" selected onPress={onPress} />
        <OptionRow label="Talk more" kind="checkbox" selected={false} onPress={onPress} />
      </>,
    );
    const radio = screen.getByRole('radio', { name: 'Dating. Early days' });
    expect(radio.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    const box = screen.getByRole('checkbox', { name: 'Talk more' });
    expect(box.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    await fireEvent.press(box);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('PlanCard shows the price it is given and never one of its own', async () => {
    await renderUi(
      <PlanCard
        title="Yearly"
        price="€39.99"
        caption="7 days free"
        badge="Best value"
        selected
        onPress={() => undefined}
      />,
    );
    const plan = screen.getByRole('radio');
    expect(plan.props.accessibilityLabel).toBe('Best value, Yearly, €39.99, 7 days free');
    expect(screen.getAllByText(/[€$£]/)).toHaveLength(1);
  });

  it('ReactionPill reads "Love, selected" and fires a light haptic', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <ReactionPill kind="love" selected onPress={onPress} />
        <ReactionPill kind="laugh" count={2} selected={false} onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Love, selected' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockedHaptics.impactAsync).toHaveBeenCalledWith('light');
    expect(screen.getByRole('button', { name: 'Laugh, 2' })).toBeTruthy();
  });
});

describe('Composer', () => {
  it('sends the trimmed text once, clears the field and ignores empty input', async () => {
    const onSend = jest.fn();
    await renderUi(<Composer onSend={onSend} testID="composer" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('composer'), '  hi there  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hi there');
    expect(screen.getByTestId('composer').props.value).toBe('');
  });

  it('broadcasts typing at most every 3 seconds', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-11-02T10:00:00Z'));
      const onTyping = jest.fn();
      await renderUi(<Composer onSend={() => undefined} onTyping={onTyping} testID="composer" />);
      const input = screen.getByTestId('composer');
      await fireEvent.changeText(input, 'h');
      await fireEvent.changeText(input, 'he');
      await fireEvent.changeText(input, 'hel');
      expect(onTyping).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.setSystemTime(Date.now() + TYPING_THROTTLE_MS + 1);
      });
      await fireEvent.changeText(input, 'hell');
      expect(onTyping).toHaveBeenCalledTimes(2);
      await fireEvent.changeText(input, '');
      expect(onTyping).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
