import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

/** D11: answers are 1 to 500 characters (the database enforces it, the app mirrors it). */
export const ANSWER_MAX_LENGTH = 500;

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  /** Screen-reader name, e.g. the question text. */
  label: string;
  placeholder?: string;
  maxLength?: number;
  testID?: string;
};

/** Multiline answer box with a live counter ("32 / 500"). Grows with its text; never scrolls a question away. */
export function AnswerField({
  value,
  onChangeText,
  label,
  placeholder,
  maxLength = ANSWER_MAX_LENGTH,
  testID,
}: Props) {
  const { t } = useTranslation();
  const { colors, type, radius, space } = useTheme();
  const [focused, setFocused] = useState(false);
  const used = value.length;
  const nearLimit = used >= maxLength * 0.9;

  return (
    <View style={{ gap: space.xs }}>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        multiline
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        selectionColor={colors.you}
        accessibilityLabel={label}
        textAlignVertical="top"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          type.body,
          {
            minHeight: 92,
            borderRadius: radius.input + 2,
            borderWidth: focused ? 2 : 1,
            borderColor: focused ? colors.you : colors.line,
            backgroundColor: colors.surface,
            color: colors.text,
            paddingHorizontal: space.lg - (focused ? 2 : 1),
            paddingVertical: space.md,
          },
        ]}
      />
      <Text
        variant="caption"
        tone={nearLimit ? 'blushText' : 'text3'}
        style={{ alignSelf: 'flex-end', fontVariant: ['tabular-nums'] }}
        accessibilityLabel={t('ui.counterA11y', { used, max: maxLength })}
        testID={testID && `${testID}-counter`}
      >
        {t('ui.counter', { used, max: maxLength })}
      </Text>
    </View>
  );
}
