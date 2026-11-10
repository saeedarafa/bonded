import { fireEvent, screen, within } from '@testing-library/react-native';
import { useState } from 'react';

import { renderUi } from '@/test/render';

import { EmojiPicker } from '../EmojiPicker';
import { ReactionRow } from '../ReactionRow';

beforeEach(() => jest.clearAllMocks());

/** A row with a tiny in-memory "server" so replace/remove can be seen. */
function Harness({ initial }: { initial: { userId: string; kind: string }[] }) {
  const [reactions, setReactions] = useState(initial);
  return (
    <ReactionRow
      testID="rx"
      reactions={reactions}
      userId="me"
      onChange={(kind) =>
        setReactions([
          ...reactions.filter((r) => r.userId !== 'me'),
          ...(kind ? [{ userId: 'me', kind }] : []),
        ])
      }
    />
  );
}

const pill = (id: string) => screen.getByTestId(`rx-${id}`);

describe('ReactionRow (D45)', () => {
  it('quick row ❤️ 😂 😮 🥹 🔥 then "+", counts per emoji, other emoji after the quick row', async () => {
    await renderUi(
      <Harness
        initial={[
          { userId: 'them', kind: '❤' }, // a bare heart counts as ❤️
          { userId: 'x', kind: '🐙' },
        ]}
      />,
    );
    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
    expect(labels).toEqual([
      'React with red heart, 1',
      'React with face with tears of joy',
      'React with face with open mouth',
      'React with face holding back tears',
      'React with fire',
      'React with octopus, 1',
      'More emoji',
    ]);
  });

  it('tap another to replace, the same to remove', async () => {
    await renderUi(<Harness initial={[{ userId: 'me', kind: '❤️' }]} />);
    expect(pill('2764').props.accessibilityLabel).toBe('Reacted with red heart, selected, 1');
    await fireEvent.press(pill('1F525'));
    expect(pill('1F525').props.accessibilityLabel).toBe('Reacted with fire, selected, 1');
    expect(pill('2764').props.accessibilityLabel).toBe('React with red heart');
    await fireEvent.press(pill('1F525'));
    expect(pill('1F525').props.accessibilityLabel).toBe('React with fire');
    expect(screen.queryByLabelText(/selected/)).toBeNull();
  });

  it('"+" opens the picker; a picked emoji is saved and the picker closes', async () => {
    await renderUi(<Harness initial={[]} />);
    expect(screen.queryByTestId('rx-picker')).toBeNull();
    await fireEvent.press(screen.getByTestId('rx-more'));
    expect(screen.getByTestId('rx-picker')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('rx-picker-search'), 'thumbs up');
    await fireEvent.press(await screen.findByTestId('rx-picker-1F44D'));
    expect(screen.queryByTestId('rx-picker')).toBeNull();
    expect(pill('1F44D').props.accessibilityLabel).toBe('Reacted with thumbs up, selected, 1');
  });

  it('picking my current emoji in the picker removes it', async () => {
    await renderUi(<Harness initial={[{ userId: 'me', kind: '🐙' }]} />);
    await fireEvent.press(screen.getByTestId('rx-more'));
    await fireEvent.changeText(screen.getByTestId('rx-picker-search'), 'octopus');
    const cell = await screen.findByTestId('rx-picker-1F419');
    expect(cell.props.accessibilityLabel).toBe('octopus, your reaction. Tap to remove');
    await fireEvent.press(cell);
    expect(screen.queryByTestId('rx-1F419')).toBeNull();
  });
});

describe('EmojiPicker (D45)', () => {
  const open = (props: Partial<Parameters<typeof EmojiPicker>[0]> = {}) => {
    const onPick = jest.fn();
    const onDismiss = jest.fn();
    return {
      onPick,
      onDismiss,
      render: (opts?: Parameters<typeof renderUi>[1]) =>
        renderUi(
          <EmojiPicker
            visible
            current={null}
            testID="pk"
            onPick={onPick}
            onDismiss={onDismiss}
            {...props}
          />,
          opts,
        ),
    };
  };

  it('categories are tabs with text (selected is not colour alone) and switch the grid', async () => {
    const p = open();
    await p.render();
    expect(screen.getByText('Pick a reaction')).toBeTruthy();
    const smileys = screen.getByTestId('pk-cat-smileys');
    expect(smileys.props.accessibilityRole).toBe('tab');
    expect(smileys.props.accessibilityState).toEqual({ selected: true });
    expect(smileys.props.style).toMatchObject({ borderWidth: 2 });
    expect(screen.getByTestId('pk-1F600')).toBeTruthy(); // grinning face
    await fireEvent.press(screen.getByTestId('pk-cat-flags'));
    expect(screen.getByTestId('pk-cat-flags').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.queryByTestId('pk-1F600')).toBeNull();
    expect(screen.getByLabelText('chequered flag')).toBeTruthy();
  });

  it('search is offline, hides the categories and has an empty state', async () => {
    const p = open();
    await p.render();
    await fireEvent.changeText(screen.getByTestId('pk-search'), 'pizza');
    expect(screen.queryByTestId('pk-cat-smileys')).toBeNull();
    await fireEvent.press(screen.getByLabelText('pizza'));
    expect(p.onPick).toHaveBeenCalledWith('🍕');
    await fireEvent.changeText(screen.getByTestId('pk-search'), 'qqqzzz');
    expect(screen.getByTestId('pk-empty')).toHaveTextContent(
      'No emoji match that. Try another word.',
    );
  });

  it('the quick row is in the picker too, with my reaction selected', async () => {
    const p = open({ current: '❤' });
    await p.render();
    const quick = screen.getByTestId('pk-quick-2764');
    expect(quick.props.accessibilityLabel).toBe('Reacted with red heart, selected');
    await fireEvent.press(screen.getByTestId('pk-quick-1F979'));
    expect(p.onPick).toHaveBeenCalledWith('🥹');
  });

  it('cells are at least 44 pt', async () => {
    await open().render();
    const style = screen.getByTestId('pk-1F600').props.style;
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBe(style.width);
  });

  it('cells grow at 200% text; dark mode renders', async () => {
    await open().render({ fontScale: 2, scheme: 'dark' });
    const style = screen.getByTestId('pk-1F600').props.style;
    // h1 line height 35 at 200% = 70, times the window font scale (jest's mock: 2), plus 8.
    expect(style.width).toBe(70 * 2 + 8);
    expect(within(screen.getByTestId('pk-grid')).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('the scrim dismisses it', async () => {
    const p = open();
    await p.render();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
  });
});
