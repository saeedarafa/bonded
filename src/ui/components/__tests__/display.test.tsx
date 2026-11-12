import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { renderUi } from '@/test/render';
import { Avatar, AvatarPair } from '../Avatar';
import { Banner, OfflineBanner } from '../Banner';
import { ChatBubble } from '../ChatBubble';
import { Chip } from '../Chip';
import { Confetti } from '../Confetti';
import { Sheet } from '../Sheet';
import { Skeleton, SkeletonGroup } from '../Skeleton';
import { TabBar } from '../TabBar';
import { TopBar } from '../TopBar';
import { TypingIndicator } from '../TypingIndicator';
import { AnswerCard } from '../AnswerCard';
import { Button } from '../Button';
import { StyleSheet, type ViewStyle } from 'react-native';
import { colors } from '../../theme';
import { Text, TITLE_MAX_FONT_SCALE } from '../../Text';

describe('person colours are relative to the viewer', () => {
  const bg = (node: { props: { style?: unknown } }) =>
    (StyleSheet.flatten(node.props.style as ViewStyle | undefined) ?? {}).backgroundColor;

  it('Avatar: me is orange, the partner is sky', async () => {
    await renderUi(
      <>
        <Avatar name="Maya" isMe testID="me" />
        <Avatar name="Sam" isMe={false} testID="partner" />
      </>,
    );
    expect(bg(screen.getByTestId('me'))).toBe(colors.light.you);
    expect(bg(screen.getByTestId('partner'))).toBe(colors.light.partner);
  });

  it('ChatBubble: my message is orange-tinted, theirs sky-tinted (dark too)', async () => {
    await renderUi(
      <>
        <ChatBubble isMe senderName="You" text="mine" testID="mine" />
        <ChatBubble isMe={false} senderName="Sam" text="theirs" testID="theirs" />
      </>,
      { scheme: 'dark' },
    );
    expect(bg(screen.getByTestId('mine'))).toBe(colors.dark.youTint);
    expect(bg(screen.getByTestId('theirs'))).toBe(colors.dark.partnerTint);
  });

  it('Avatar pair reads as one element', async () => {
    await renderUi(<AvatarPair meName="Maya" partnerName="Sam" />);
    expect(screen.getByLabelText('Maya and Sam')).toBeTruthy();
  });

  it('Button colours come from the active scheme', async () => {
    const { unmount } = await renderUi(<Button label="Go" onPress={() => undefined} />);
    const light = bg(screen.getByRole('button'));
    await unmount();
    await renderUi(<Button label="Go" onPress={() => undefined} variant="destructive" />, {
      scheme: 'dark',
    });
    expect(light).toBe(colors.light.you);
    expect(bg(screen.getByRole('button'))).toBe(colors.dark.blush);
  });
});

describe('ChatBubble', () => {
  it('reads sender, text and time as one message', async () => {
    await renderUi(<ChatBubble isMe={false} senderName="Sam" text="Hi" time="21:04" />);
    expect(screen.getByLabelText('Sam, Hi, 21:04')).toBeTruthy();
  });

  it('a failed message offers a retry', async () => {
    const onRetry = jest.fn();
    await renderUi(
      <ChatBubble
        isMe
        senderName="You"
        text="Hi"
        status="failed"
        statusLabel="Not sent. Tap to retry"
        onRetry={onRetry}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Not sent. Tap to retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AnswerCard', () => {
  it('shows the whole answer', async () => {
    const long = 'x'.repeat(500);
    await renderUi(<AnswerCard name="Sam" isMe={false} body={long} />);
    expect(screen.getByText(long)).toBeTruthy();
  });

  it('"You" cards show my initial, not "Y" (#37)', async () => {
    await renderUi(<AnswerCard name="You" avatarName="Maya" isMe body="hi" />);
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.queryByText('Y')).toBeNull();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('a locked answer shows no text and says it is locked', async () => {
    await renderUi(<AnswerCard name="Sam" isMe={false} locked body="never shown" />);
    expect(screen.queryByText('never shown')).toBeNull();
    expect(
      screen.getAllByLabelText("Sam's answer is locked until you both answer.").length,
    ).toBeGreaterThan(0);
  });
});

describe('Chip, Skeleton, TypingIndicator', () => {
  it('Chip carries its label', async () => {
    await renderUi(<Chip label="Ends in 23:59:41" tone="countdown" />);
    expect(screen.getByLabelText('Ends in 23:59:41')).toBeTruthy();
  });

  it.each(['light', 'dark'] as const)(
    'the status chip (55 "Waiting to send") is neutral, not premium gold (D44, %s)',
    async (scheme) => {
      await renderUi(<Chip label="Waiting to send" tone="status" testID="chip" />, { scheme });
      const c = colors[scheme];
      const bg = StyleSheet.flatten(screen.getByTestId('chip').props.style as ViewStyle) ?? {};
      expect(bg.backgroundColor).toBe(c.surface2);
      expect(screen.getByText('Waiting to send')).toHaveStyle({ color: c.text2 });
      for (const gold of [c.premium, c.premiumTint, c.premiumText]) {
        expect([bg.backgroundColor, c.text2]).not.toContain(gold);
      }
    },
  );

  it('Skeletons are hidden from screen readers; the group announces Loading once', async () => {
    await renderUi(
      <SkeletonGroup testID="group">
        <Skeleton testID="s1" />
        <Skeleton testID="s2" />
      </SkeletonGroup>,
    );
    expect(screen.getByLabelText('Loading').props.accessibilityState).toEqual({ busy: true });
    expect(screen.queryByTestId('s1', { includeHiddenElements: false })).toBeNull();
  });

  it('TypingIndicator names who is typing', async () => {
    await renderUi(<TypingIndicator name="Sam" />);
    expect(screen.getByLabelText('Sam is typing')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('TabBar labels stop growing at 200% so they never break mid-word (#37)', async () => {
    await renderUi(
      <TabBar
        bottomInset={34}
        items={[{ key: 'a', label: 'Today', icon: 'today', focused: true, onPress: () => {} }]}
      />,
    );
    expect(screen.getByText('Today').props.maxFontSizeMultiplier).toBe(2);
  });

  it('TabBar marks the selected tab and routes presses', async () => {
    const onPress = jest.fn();
    await renderUi(
      <TabBar
        bottomInset={34}
        items={[
          { key: 'a', label: 'Today', icon: 'today', focused: true, onPress: () => undefined },
          { key: 'b', label: 'History', icon: 'history', focused: false, onPress },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Today' }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    await fireEvent.press(screen.getByRole('tab', { name: 'History' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('TopBar back button is labelled and 44 pt', async () => {
    const onBack = jest.fn();
    await renderUi(<TopBar title="Thread" onBack={onBack} />);
    const back = screen.getByRole('button', { name: 'Back' });
    expect(StyleSheet.flatten(back.props.style).height).toBeGreaterThanOrEqual(44);
    await fireEvent.press(back);
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Thread' })).toBeTruthy();
  });
});

describe('overlays', () => {
  it('Sheet renders nothing while closed', async () => {
    await renderUi(
      <Sheet visible={false} onDismiss={() => undefined} title="Details">
        <RNText>inside</RNText>
      </Sheet>,
    );
    expect(screen.queryByText('inside')).toBeNull();
  });

  it('Sheet shows its content and dismisses from the scrim and the system back', async () => {
    const onDismiss = jest.fn();
    await renderUi(
      <Sheet visible onDismiss={onDismiss} title="Details">
        <RNText>inside</RNText>
      </Sheet>,
    );
    expect(screen.getByText('inside')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Details' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Android back and the iOS dismiss gesture arrive as onRequestClose on the Modal.
    expect(screen.getByTestId('sheet-modal').props.onRequestClose).toBe(onDismiss);
  });

  it('Sheet closes on the VoiceOver escape gesture (MOB-25)', async () => {
    const onDismiss = jest.fn();
    await renderUi(
      <Sheet visible onDismiss={onDismiss} title="Details" testID="sheet">
        <RNText>inside</RNText>
      </Sheet>,
    );
    await fireEvent(screen.getByTestId('sheet'), 'accessibilityEscape');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Banner is a polite alert', async () => {
    await renderUi(<Banner message="You're offline." />);
    const banner = screen.getByRole('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
  });

  it('OfflineBanner appears only while offline', async () => {
    onlineManager.setOnline(true);
    await renderUi(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    await act(async () => {
      onlineManager.setOnline(false);
    });
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    expect(screen.getByText("You're offline. Changes will send when you're back.")).toBeTruthy();
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('Confetti renders seeds when active and nothing with reduced motion', async () => {
    const { unmount } = await renderUi(<Confetti active testID="confetti" />);
    expect(screen.getByTestId('confetti', { includeHiddenElements: true })).toBeTruthy();
    await unmount();
    await renderUi(<Confetti active testID="confetti" />, { reducedMotion: true });
    expect(screen.queryByTestId('confetti', { includeHiddenElements: true })).toBeNull();
  });

  it('Confetti calls onDone after its bursts', async () => {
    jest.useFakeTimers();
    try {
      const onDone = jest.fn();
      await renderUi(<Confetti active bursts={3} onDone={onDone} />);
      await act(async () => {
        jest.advanceTimersByTime(1600 * 3 + 500);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('largest text (AX5) caps (MOB-80)', () => {
  it('#358: display styles stop at 200% by default; body text keeps growing; callers can override', async () => {
    await renderUi(
      <>
        <Text variant="display">display</Text>
        <Text variant="h1">h1</Text>
        <Text variant="h2">h2</Text>
        <Text variant="number">42</Text>
        <Text variant="body">body</Text>
        <Text variant="caption">caption</Text>
        <Text variant="label">label</Text>
        <Text variant="h1" maxFontSizeMultiplier={1.5}>
          own cap
        </Text>
      </>,
    );
    expect(TITLE_MAX_FONT_SCALE).toBe(2);
    for (const capped of ['display', 'h1', 'h2', '42']) {
      expect(screen.getByText(capped).props.maxFontSizeMultiplier).toBe(TITLE_MAX_FONT_SCALE);
    }
    for (const free of ['body', 'caption', 'label']) {
      expect(screen.getByText(free).props.maxFontSizeMultiplier).toBeUndefined();
    }
    expect(screen.getByText('own cap').props.maxFontSizeMultiplier).toBe(1.5);
  });

  it('#357: chip labels stop at 200% and a TopBar action shrinks inside the screen', async () => {
    await renderUi(
      <TopBar
        title="Today's question"
        testID="bar"
        right={<Chip tone="streak" label="12 · bonded today" testID="chip" />}
      />,
    );
    expect(screen.getByText('12 · bonded today').props.maxFontSizeMultiplier).toBe(2);
    // The chip's nearest host ancestor with a style is the right-hand slot.
    type Node = { type: unknown; props: { style?: ViewStyle }; parent: Node | null };
    let node = (screen.getByTestId('chip') as unknown as Node).parent;
    while (node && (typeof node.type !== 'string' || !node.props.style)) node = node.parent;
    expect(StyleSheet.flatten(node?.props.style)).toMatchObject({ maxWidth: '50%', flexShrink: 1 });
  });
});
