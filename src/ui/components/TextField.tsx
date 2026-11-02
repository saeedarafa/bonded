import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useShake } from '../useShake';

export const INPUT_MIN_HEIGHT = 52;

type Props = Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'placeholder'
  | 'autoCapitalize'
  | 'autoComplete'
  | 'autoCorrect'
  | 'keyboardType'
  | 'returnKeyType'
  | 'onSubmitEditing'
  | 'textContentType'
  | 'maxLength'
  | 'secureTextEntry'
> & {
  /** Screen-reader name (and the visible caption when `showLabel`). */
  label: string;
  showLabel?: boolean;
  /** Error message; turns the border blush, shakes once and is announced. */
  error?: string | null;
  testID?: string;
};

/** Default, focus (2 pt orange border) and error (blush border + message). */
export function TextField({ label, showLabel = false, error, testID, ...input }: Props) {
  const { colors, type, radius, space } = useTheme();
  const [focused, setFocused] = useState(false);
  const shake = useShake(error);
  const thick = focused || !!error;
  const border = error ? colors.blush : focused ? colors.you : colors.line;

  return (
    <View style={{ gap: space.xs }}>
      {showLabel ? (
        <Text variant="label" tone="text2">
          {label}
        </Text>
      ) : null}
      <Animated.View style={shake}>
        <TextInput
          {...input}
          testID={testID}
          accessibilityLabel={label}
          placeholderTextColor={colors.text3}
          selectionColor={colors.you}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            type.body,
            {
              minHeight: INPUT_MIN_HEIGHT,
              borderRadius: radius.input,
              borderWidth: thick ? 2 : 1,
              borderColor: border,
              backgroundColor: colors.surface,
              color: colors.text,
              paddingHorizontal: thick ? space.lg - 2 : space.lg - 1,
              paddingVertical: space.sm,
            },
          ]}
        />
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
