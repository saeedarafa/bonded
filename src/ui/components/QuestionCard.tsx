import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Chip } from './Chip';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

type Props = {
  /** "Day 12 · Today". */
  dayLabel: string;
  /** The question. Never truncated, at any font size. */
  question: string;
  /** Right-hand caption, e.g. "New in 14:22:09" (tabular numerals). */
  meta?: string;
  /** Action area under the question. */
  children?: ReactNode;
  testID?: string;
};

export function QuestionCard({ dayLabel, question, meta, children, testID }: Props) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.sm,
        }}
      >
        <Chip label={dayLabel} />
        {meta ? (
          <Text variant="caption" tone="text3" style={{ fontVariant: ['tabular-nums'] }}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Text variant="h2" accessibilityRole="header">
        {question}
      </Text>
      {children}
    </View>
  );
}
