import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputInstance } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useShake } from '../useShake';

/** The invite code is shown as `BND·1234` (D01): the prefix is fixed, the person types 4 digits. */
export const INVITE_PREFIX = 'BND';
export const CODE_LENGTH = 4;

/** Keeps digits only, so pasting "BND·1234" or "bnd 1234" works. */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

type Props = {
  /** The digits typed so far (0 to 4). */
  value: string;
  onChange: (digits: string) => void;
  /** Called once when the 4th digit is entered. */
  onComplete?: (digits: string) => void;
  error?: string | null;
  autoFocus?: boolean;
  testID?: string;
};

/**
 * One invisible TextInput (so paste, autofill and the number pad just work) over four cells.
 * Screen readers get the single input, not the cells.
 */
export function CodeInput({ value, onChange, onComplete, error, autoFocus, testID }: Props) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const input = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const shake = useShake(error);
  const digits = sanitizeCode(value);

  const lastCompleted = useRef('');
  useEffect(() => {
    if (digits.length === CODE_LENGTH && lastCompleted.current !== digits) {
      lastCompleted.current = digits;
      onComplete?.(digits);
    } else if (digits.length < CODE_LENGTH) {
      lastCompleted.current = '';
    }
  }, [digits, onComplete]);

  return (
    <View style={{ gap: space.xs }}>
      <Animated.View style={shake}>
        <Pressable
          onPress={() => input.current?.focus()}
          accessible={false}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
        >
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text variant="h2" tone="text2">
              {INVITE_PREFIX}·
            </Text>
          </View>
          {Array.from({ length: CODE_LENGTH }, (_, i) => {
            const active = focused && i === Math.min(digits.length, CODE_LENGTH - 1);
            return (
              <View
                key={i}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                style={{
                  flex: 1,
                  minHeight: 56,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.input,
                  borderWidth: error || active ? 2 : 1,
                  borderColor: error ? colors.blush : active ? colors.you : colors.line,
                  backgroundColor: colors.surface,
                }}
              >
                <Text variant="number">{digits[i] ?? ''}</Text>
              </View>
            );
          })}
          <TextInput
            ref={input}
            testID={testID}
            value={digits}
            onChangeText={(raw) => onChange(sanitizeCode(raw))}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH + 8}
            autoComplete="off"
            autoCorrect={false}
            autoFocus={autoFocus}
            caretHidden
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel={t('ui.inviteCode')}
            accessibilityHint={t('ui.inviteCodeHint')}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.015 }}
          />
        </Pressable>
      </Animated.View>
      {error ? (
        <Text variant="caption" tone="blushText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
