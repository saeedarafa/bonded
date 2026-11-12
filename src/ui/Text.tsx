import { Text as RNText, type TextProps } from 'react-native';

import type { ColorToken, TypeName } from './theme';
import { useTheme } from './ThemeProvider';

/**
 * #84: titles stop growing at 200% (DESIGN's Dynamic Type ceiling). At AX5 (~310%) "Today's
 * question" broke mid-word on an iPhone SE and filled most of the screen.
 */
export const TITLE_MAX_FONT_SCALE = 2;

/**
 * #358 (MOB-80): the big display styles stop at 200% unless a caller says otherwise. At AX5 one
 * word of an `h1` is wider than an iPhone SE, so titles broke mid-word ("questi / on").
 */
const CAPPED: ReadonlySet<TypeName> = new Set<TypeName>(['display', 'h1', 'h2', 'number']);

type Props = TextProps & {
  /** Type token from DESIGN.md §3. */
  variant?: TypeName;
  /** Colour token; use the `*Text` shades for coloured text on cream (Rule 3). */
  tone?: ColorToken;
};

/**
 * Themed text. Font scaling stays ON (Dynamic Type up to 200%; display styles stop there, #358),
 * and it never truncates unless a caller passes `numberOfLines` on purpose (never for questions
 * or answers).
 */
export function Text({
  variant = 'body',
  tone = 'text',
  style,
  maxFontSizeMultiplier,
  ...rest
}: Props) {
  const { type, colors } = useTheme();
  const cap = maxFontSizeMultiplier ?? (CAPPED.has(variant) ? TITLE_MAX_FONT_SCALE : undefined);
  return (
    <RNText
      {...rest}
      {...(cap !== undefined ? { maxFontSizeMultiplier: cap } : {})}
      style={[type[variant], { color: colors[tone] }, style]}
    />
  );
}
