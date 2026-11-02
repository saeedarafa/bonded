import { Text as RNText, type TextProps } from 'react-native';

import type { ColorToken, TypeName } from './theme';
import { useTheme } from './ThemeProvider';

type Props = TextProps & {
  /** Type token from DESIGN.md §3. */
  variant?: TypeName;
  /** Colour token; use the `*Text` shades for coloured text on cream (Rule 3). */
  tone?: ColorToken;
};

/**
 * Themed text. Font scaling stays ON (Dynamic Type up to 200%), and it never truncates unless a
 * caller passes `numberOfLines` on purpose (never for questions or answers).
 */
export function Text({ variant = 'body', tone = 'text', style, ...rest }: Props) {
  const { type, colors } = useTheme();
  return <RNText {...rest} style={[type[variant], { color: colors[tone] }, style]} />;
}
