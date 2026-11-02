// Bonded theme. Values come from src/ui/tokens.json, a copy of design-handoff/tokens/tokens.json
// (a test fails if the two drift). Colours are relative to the viewer: `you` is always the
// signed-in user, `partner` the other person. This file and tokens.json are the only places
// allowed to contain colour literals (see eslint.config.js).
import type { TextStyle } from 'react-native';

import tokens from './tokens.json';

export type ColorScheme = 'light' | 'dark';
export type ThemeColors = typeof tokens.color.light;
export type ColorToken = keyof ThemeColors;

export const colors: Record<ColorScheme, ThemeColors> = tokens.color;

/** Font family names, as registered by `useFonts` in src/ui/fonts.ts. */
export const fonts = {
  display: { 600: 'Outfit_600SemiBold', 700: 'Outfit_700Bold', 800: 'Outfit_800ExtraBold' },
  body: {
    400: 'DMSans_400Regular',
    500: 'DMSans_500Medium',
    600: 'DMSans_600SemiBold',
    700: 'DMSans_700Bold',
  },
} as const;

type FontFamily = keyof typeof fonts;
type TypeToken = {
  family: string;
  size: number;
  weight: number;
  lineHeight?: number;
  tabularNums?: boolean;
};
export type TypeName = keyof typeof tokens.type;

function fontFamilyFor(family: string, weight: number): string {
  const byWeight = fonts[family as FontFamily] as Record<number, string> | undefined;
  const name = byWeight?.[weight];
  if (!name) throw new Error(`No font loaded for ${family} ${weight}`);
  return name;
}

/**
 * Ready-to-use text styles. The weight is baked into the font family (no `fontWeight`),
 * which is what Android needs for custom fonts. Numbers that change use tabular numerals.
 */
export const type = Object.fromEntries(
  Object.entries(tokens.type as Record<TypeName, TypeToken>).map(([name, t]) => {
    const style: TextStyle = {
      fontFamily: fontFamilyFor(t.family, t.weight),
      fontSize: t.size,
      ...(t.lineHeight !== undefined && { lineHeight: t.lineHeight }),
      ...(t.tabularNums && { fontVariant: ['tabular-nums'] }),
    };
    return [name, style];
  }),
) as Record<TypeName, TextStyle>;

export const space = tokens.space;
export const radius = tokens.radius;
export const size = tokens.size;
export const motion = tokens.motion;

export type PersonColors = { fill: string; text: string; tint: string; on: string };

/**
 * Orange for the viewer, sky for the partner, on both phones.
 * `isMe` must be `row.user_id === session.user.id`; never derive it from anything else.
 */
export function personColors(c: ThemeColors, isMe: boolean): PersonColors {
  return isMe
    ? { fill: c.you, text: c.youText, tint: c.youTint, on: c.onYou }
    : { fill: c.partner, text: c.partnerText, tint: c.partnerTint, on: c.onPartner };
}
