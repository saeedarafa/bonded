import { View } from 'react-native';

import { useTranslation } from '@/i18n';

import { emojiName, normalizeReaction } from '../emoji';
import { Text } from '../Text';
import { personColors } from '../theme';
import { useTheme } from '../ThemeProvider';

type Props = {
  reactions: readonly { id: string; userId: string; kind: string }[];
  /** The viewer: their reaction reads "You", in their colour (orange); the partner's in sky. */
  userId: string | null | undefined;
  /** "You" and the partner's name, from t(). */
  meName: string;
  partnerName: string;
  testID?: string;
};

/**
 * Read-only reactions (30 archive, D45): each person's emoji and who sent it. Nothing to tap;
 * one accessible element per reaction ("Sam reacted with red heart"). Renders nothing when empty.
 */
export function ReactionSummary({ reactions, userId, meName, partnerName, testID }: Props) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  if (reactions.length === 0) return null;
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {reactions.map((r) => {
        const mine = !!userId && r.userId === userId;
        const kind = normalizeReaction(r.kind);
        const who = mine ? meName : partnerName;
        return (
          <View
            key={r.id}
            accessible
            accessibilityLabel={t('ui.reaction.by', { who, name: emojiName(kind) })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              paddingHorizontal: space.sm,
              borderRadius: radius.pill,
              backgroundColor: colors.surface2,
            }}
          >
            <Text variant="label">{kind}</Text>
            <Text variant="caption" style={{ color: personColors(colors, mine).text }}>
              {who}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
