import { fireEvent, screen, within } from '@testing-library/react-native';

import {
  hasTodayActions,
  TodayActions,
  TodayBody,
  type TodayBodyProps,
} from '@/features/daily/components/TodayBody';
import { normalizeStreak } from '@/features/daily/today';
import { renderUi } from '@/test/render';

const base: TodayBodyProps = {
  state: 'yourTurn',
  me: 'Maya',
  partner: 'Sam',
  partnerJoined: true,
  partnerAnswered: true,
  question: "What's a small thing I do that makes your day better?",
  day: 12,
  myAnsweredAt: null,
  streak: { ...normalizeStreak(null), current: 11, longest: 11, lastCompletedOn: '2026-11-01' },
  secondsLeft: 51729,
  onNudge: null,
  nudging: false,
  onAnswer: jest.fn(),
  onThread: jest.fn(),
  onReveal: null,
  onSaver: jest.fn(),
};

describe('TodayBody', () => {
  it('18: partner answered, live countdown, Answer opens the composer', async () => {
    const onAnswer = jest.fn();
    await renderUi(<TodayBody {...base} onAnswer={onAnswer} />);
    expect(screen.getByTestId('18-screen')).toBeTruthy();
    expect(
      screen.getByText('Sam already answered. Your answer keeps your streak going.'),
    ).toBeTruthy();
    expect(screen.getByText('New in 14:22:09')).toBeTruthy();
    expect(screen.getByText('Day 12 · Today')).toBeTruthy();
    expect(screen.getByLabelText('Sam, Answered · locked until you reply')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('18-answer'));
    expect(onAnswer).toHaveBeenCalled();
  });

  it('18 and 23: the "You" row shows my initial, not "Y" (#37)', async () => {
    await renderUi(<TodayBody {...base} />);
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.queryByText('Y')).toBeNull();
    await renderUi(<TodayBody {...base} state="waiting" myAnsweredAt="08:12" />);
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('18 solo: the partner has not joined yet', async () => {
    await renderUi(<TodayBody {...base} partnerJoined={false} partnerAnswered={false} />);
    expect(screen.getByLabelText("Sam, Hasn't joined yet")).toBeTruthy();
    expect(screen.getByLabelText("Bao is saving a seat. Sam hasn't joined yet.")).toBeTruthy();
  });

  it('23: names the partner, keeps the streak hint, no nudge with the kill switch off', async () => {
    await renderUi(
      <TodayBody {...base} state="waiting" partnerAnswered={false} myAnsweredAt="08:12" />,
    );
    expect(screen.getByTestId('23-screen')).toBeTruthy();
    expect(screen.getByText("You answered. Now it's Sam's turn.")).toBeTruthy();
    expect(screen.getByText('Answered at 08:12')).toBeTruthy();
    expect(screen.queryByTestId('23-nudge')).toBeNull();
    expect(
      screen.getByText('Answer together by midnight to keep your 11-day streak.'),
    ).toBeTruthy();
  });

  it('23 after nudging today: a line instead of the button, the streak hint stays', async () => {
    await renderUi(
      <TodayBody {...base} state="waiting" partnerAnswered={false} onNudge={jest.fn()} nudged />,
    );
    expect(screen.queryByTestId('23-nudge')).toBeNull();
    expect(screen.getByTestId('23-nudged')).toHaveTextContent('You nudged Sam today.');
    expect(screen.getByTestId('23-hint')).toBeTruthy();
  });

  it('23 with nudges live: one tap sends', async () => {
    const onNudge = jest.fn();
    await renderUi(
      <TodayBody {...base} state="waiting" partnerAnswered={false} onNudge={onNudge} />,
    );
    await fireEvent.press(screen.getByTestId('23-nudge'));
    expect(onNudge).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Nudge Sam')).toBeTruthy();
  });

  it('24: streak title, next badge and countdown', async () => {
    const onThread = jest.fn();
    await renderUi(
      <TodayBody
        {...base}
        state="bonded"
        streak={{ ...base.streak, current: 12, completedToday: true }}
        secondsLeft={34867}
        onThread={onThread}
      />,
    );
    expect(screen.getByText('Bonded today.\n12 days in a row.')).toBeTruthy();
    expect(screen.getByText('Next: 14 days · 2 to go')).toBeTruthy();
    expect(screen.getByTestId('24-countdown')).toHaveTextContent('09:41:07');
    await fireEvent.press(screen.getByText("Revisit today's thread"));
    expect(onThread).toHaveBeenCalled();
    expect(screen.queryByTestId('24-reveal')).toBeNull();
  });

  it("24 before I've opened the partner's answer offers hold to reveal", async () => {
    const onReveal = jest.fn();
    await renderUi(<TodayBody {...base} state="bonded" onReveal={onReveal} />);
    await fireEvent.press(screen.getByText("See Sam's answer"));
    expect(onReveal).toHaveBeenCalled();
  });

  it("24 counts the partner's unread thread messages", async () => {
    await renderUi(<TodayBody {...base} state="bonded" unread={2} />);
    expect(screen.getByText("Revisit today's thread (2 new)")).toBeTruthy();
  });

  it('24 on day one does not say "1 days"', async () => {
    await renderUi(<TodayBody {...base} state="bonded" streak={{ ...base.streak, current: 1 }} />);
    expect(screen.getByText('Bonded today.\nYour streak starts here.')).toBeTruthy();
  });

  it('28: no guilt, longest streak, saver is premium', async () => {
    const onSaver = jest.fn();
    await renderUi(
      <TodayBody
        {...base}
        state="napping"
        partnerAnswered={false}
        streak={{ ...base.streak, current: 0, longest: 41 }}
        onSaver={onSaver}
      />,
      { scheme: 'dark' },
    );
    expect(screen.getByText('Bao and Bun are napping')).toBeTruthy();
    expect(screen.getByText('41 days')).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('28-saver'));
    expect(onSaver).toHaveBeenCalled();
  });

  it('wraps at 200% text without truncating the question', async () => {
    await renderUi(<TodayBody {...base} />, { fontScale: 2 });
    expect(screen.getByText(base.question).props.numberOfLines).toBeUndefined();
  });
});

describe('TodayActions (#33: pinned above the tab bar)', () => {
  it('hasTodayActions: every state has one, except 23 while nudges are off', () => {
    expect(hasTodayActions({ state: 'yourTurn', onNudge: null })).toBe(true);
    expect(hasTodayActions({ state: 'bonded', onNudge: null })).toBe(true);
    expect(hasTodayActions({ state: 'napping', onNudge: null })).toBe(true);
    expect(hasTodayActions({ state: 'waiting', onNudge: null })).toBe(false);
    expect(hasTodayActions({ state: 'waiting', onNudge: jest.fn() })).toBe(true);
  });

  it('pinned: the body leaves the main action out, TodayActions renders it', async () => {
    const onAnswer = jest.fn();
    await renderUi(<TodayBody {...base} onAnswer={onAnswer} pinnedActions />);
    expect(screen.queryByTestId('18-answer')).toBeNull();
    expect(screen.queryByTestId('today-actions')).toBeNull();
    await renderUi(<TodayActions {...base} onAnswer={onAnswer} pinnedActions />);
    await fireEvent.press(screen.getByTestId('18-answer'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('one action per state: 24 reveal + thread, 28 wake up', async () => {
    const onReveal = jest.fn();
    await renderUi(<TodayActions {...base} state="bonded" onReveal={onReveal} />);
    expect(screen.getByTestId('24-reveal')).toBeTruthy();
    expect(screen.getByTestId('24-thread')).toBeTruthy();
    await renderUi(<TodayActions {...base} state="napping" />);
    expect(screen.getByTestId('28-answer')).toBeTruthy();
    expect(screen.queryByTestId('18-answer')).toBeNull();
  });

  it('23 without a nudge renders nothing; the streak line stays in the body', async () => {
    const waiting = { ...base, state: 'waiting' as const, partnerAnswered: false };
    await renderUi(<TodayActions {...waiting} />);
    expect(screen.queryByTestId('today-actions')).toBeNull();
    await renderUi(<TodayBody {...waiting} pinnedActions />);
    expect(screen.getByTestId('23-hint')).toBeTruthy();
  });

  it('23 with a nudge: the streak line moves with the button, under it (board order)', async () => {
    const waiting = { ...base, state: 'waiting' as const, onNudge: jest.fn() };
    await renderUi(<TodayBody {...waiting} pinnedActions />);
    expect(screen.queryByTestId('23-hint')).toBeNull();
    await renderUi(<TodayActions {...waiting} />);
    const actions = within(screen.getByTestId('today-actions'));
    expect(actions.getByTestId('23-nudge')).toBeTruthy();
    expect(actions.getByTestId('23-hint')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('"23-nudge"')).toBeLessThan(tree.indexOf('"23-hint"'));
  });
});
