import { useRef, useState, type ComponentRef } from 'react';
import { TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useShake } from '../useShake';
import { INPUT_MIN_HEIGHT } from './TextField';

/** The typed parts of a calendar date: digits only, possibly incomplete. */
export type DateFieldValue = { year: string; month: string; day: string };
type Part = keyof DateFieldValue;

const MAX: Record<Part, number> = { month: 2, day: 2, year: 4 };

/** Segment order from the locale catalogue (`ui.date.order`, e.g. "mdy"); falls back to m-d-y. */
function orderFrom(value: string): Part[] {
  const byLetter: Record<string, Part> = { m: 'month', d: 'day', y: 'year' };
  const parts = value
    .split('')
    .map((c) => byLetter[c])
    .filter((p): p is Part => p !== undefined);
  return new Set(parts).size === 3 ? parts : ['month', 'day', 'year'];
}

type Props = {
  /** Visible caption and the start of every segment's screen-reader name ("Together since, month"). */
  label: string;
  value: DateFieldValue;
  onChange: (next: DateFieldValue) => void;
  /** Error message; blush borders, one shake and an announcement (as TextField). */
  error?: string | null;
  /** Segments get `<testID>-month|-day|-year`, the message `<testID>-error`. */
  testID?: string;
  showLabel?: boolean;
};

/**
 * DateField (screen 47): three number fields in the locale's order, typed rather than picked so it
 * needs no native module and works with a screen reader and at 200% text (the segments wrap).
 * Focus moves on when a segment is full. Validation is the caller's (see keyDates/model).
 */
export function DateField({ label, value, onChange, error, testID, showLabel = true }: Props) {
  const { t } = useTranslation();
  const { colors, type, radius, space } = useTheme();
  const [focused, setFocused] = useState<Part | null>(null);
  const shake = useShake(error);
  const refs = useRef<Partial<Record<Part, ComponentRef<typeof TextInput> | null>>>({});
  const order = orderFrom(t('ui.date.order'));

  function change(part: Part, text: string) {
    const digits = text.replace(/\D/g, '').slice(0, MAX[part]);
    onChange({ ...value, [part]: digits });
    const next = order[order.indexOf(part) + 1];
    if (digits.length === MAX[part] && next) refs.current[next]?.focus();
  }

  return (
    <View style={{ gap: space.xs }} testID={testID}>
      {showLabel ? (
        <Text variant="label" tone="text2">
          {label}
        </Text>
      ) : null}
      <Animated.View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }, shake]}>
        {order.map((part) => {
          const thick = focused === part || !!error;
          const border = error ? colors.blush : focused === part ? colors.you : colors.line;
          return (
            <TextInput
              key={part}
              ref={(node) => {
                refs.current[part] = node;
              }}
              testID={testID && `${testID}-${part}`}
              accessibilityLabel={t(`ui.date.${part}`, { label })}
              placeholder={t(`ui.date.${part}Placeholder`)}
              placeholderTextColor={colors.text3}
              selectionColor={colors.you}
              value={value[part]}
              onChangeText={(text) => change(part, text)}
              onFocus={() => setFocused(part)}
              onBlur={() => setFocused((f) => (f === part ? null : f))}
              keyboardType="number-pad"
              maxLength={MAX[part]}
              // Not every date is a birthday: never autofill one into "Together since".
              autoComplete="off"
              style={[
                type.body,
                {
                  flexGrow: part === 'year' ? 1.6 : 1,
                  flexBasis: part === 'year' ? 96 : 64,
                  minHeight: INPUT_MIN_HEIGHT,
                  borderRadius: radius.input,
                  borderWidth: thick ? 2 : 1,
                  borderColor: border,
                  backgroundColor: colors.surface,
                  color: colors.text,
                  paddingHorizontal: thick ? space.lg - 2 : space.lg - 1,
                  paddingVertical: space.sm,
                  fontVariant: ['tabular-nums'],
                  textAlign: 'center',
                },
              ]}
            />
          );
        })}
      </Animated.View>
      {error ? (
        <Text
          variant="caption"
          tone="blushText"
          accessibilityLiveRegion="polite"
          testID={testID && `${testID}-error`}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
