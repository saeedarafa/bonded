import { Pressable } from 'react-native';

import { useTranslation } from '@/i18n';

import { haptics } from '../haptics';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

/** UI reaction kinds. The database column and its allowed values are the backend's (CONTRACTS §2). */
export type ReactionKind = 'love' | 'laugh' | 'wow';
export const reactionKinds: readonly ReactionKind[] = ['love', 'laugh', 'wow'];

const icons: Record<ReactionKind, IconName> = { love: 'heart', laugh: 'smile', wow: 'sparkle' };

type Props = {
  kind: ReactionKind;
  /** Total reactions of this kind; omit or 0 to hide the number. */
  count?: number;
  /** I reacted with this kind. */
  selected: boolean;
  onPress: () => void;
  testID?: string;
};

/** 44 × 44 minimum (DESIGN.md §4). Label: "Love, selected". Light haptic on tap. */
export function ReactionPill({ kind, count = 0, selected, onPress, testID }: Props) {
  const { t } = useTranslation();
  const { colors, radius, space, size } = useTheme();
  const name = t(`ui.reaction.${kind}`);
  const withCount = count > 0 ? t('ui.reaction.count', { name, n: count }) : name;
  const label = selected ? t('ui.reaction.selected', { name: withCount }) : withCount;
  const fg = selected ? colors.youText : colors.text2;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        haptics.light();
        onPress();
      }}
      style={{
        minHeight: size.tapTarget,
        minWidth: size.tapTarget,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xs,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.you : colors.line,
        backgroundColor: selected ? colors.youTint : colors.surface2,
      }}
    >
      <Icon name={icons[kind]} size={16} color={fg} filled={selected && kind === 'love'} />
      {count > 0 ? (
        <Text variant="caption" style={{ color: fg, fontVariant: ['tabular-nums'] }}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
