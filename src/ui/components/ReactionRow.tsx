import { useState } from 'react';
import { View } from 'react-native';

import { emojiId, myReaction, nextReaction, reactionCounts } from '../emoji';
import { useTheme } from '../ThemeProvider';
import { EmojiPicker } from './EmojiPicker';
import { MoreReactionsPill, ReactionPill } from './ReactionPill';

type Props = {
  /** Every reaction on the target (answer or message) that RLS returned. */
  reactions: readonly { userId: string; kind: string }[];
  /** The viewer; their reaction is the selected pill. */
  userId: string | null | undefined;
  /** My new reaction: an emoji to set (replaces mine), or null to remove mine. */
  onChange: (next: string | null) => void;
  /**
   * Prefix for testIDs: `<id>-<emojiId>` per pill (`21-react-2764` is ❤️), `<id>-more`, and the
   * picker under `<id>-picker`.
   */
  testID: string;
};

/**
 * D45 reaction row (21, DS-Components): the quick row ❤️ 😂 😮 🥹 🔥, then any other emoji someone
 * picked (with its count), then "+" for the full picker. One reaction per person: another emoji
 * replaces mine, the same one removes it.
 */
export function ReactionRow({ reactions, userId, onChange, testID }: Props) {
  const { space } = useTheme();
  const [picking, setPicking] = useState(false);
  const mine = myReaction(reactions, userId);
  const counts = reactionCounts(reactions, userId, { includeQuick: true });

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {counts.map((c) => (
        <ReactionPill
          key={c.kind}
          testID={`${testID}-${emojiId(c.kind)}`}
          kind={c.kind}
          count={c.count}
          selected={c.mine}
          onPress={() => onChange(nextReaction(mine, c.kind))}
        />
      ))}
      <MoreReactionsPill testID={`${testID}-more`} onPress={() => setPicking(true)} />
      <EmojiPicker
        testID={`${testID}-picker`}
        visible={picking}
        current={mine}
        onDismiss={() => setPicking(false)}
        onPick={(emoji) => {
          setPicking(false);
          onChange(nextReaction(mine, emoji));
        }}
      />
    </View>
  );
}
