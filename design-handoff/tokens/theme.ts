// Bonded theme for Expo / React Native. Generated from tokens.json; edit tokens.json first, then this file.
// Colors are relative to the viewer: `you` is always the signed-in user, `partner` is the other person.
import tokens from './tokens.json';

export type ColorScheme = 'light' | 'dark';
export type ThemeColors = typeof tokens.color.light;

export const colors: Record<ColorScheme, ThemeColors> = tokens.color;

export const fonts = {
  display: { 600: 'Outfit_600SemiBold', 700: 'Outfit_700Bold', 800: 'Outfit_800ExtraBold' },
  body: { 400: 'DMSans_400Regular', 500: 'DMSans_500Medium', 600: 'DMSans_600SemiBold', 700: 'DMSans_700Bold' },
} as const;

export const type = tokens.type;
export const space = tokens.space;
export const radius = tokens.radius;
export const size = tokens.size;
export const motion = tokens.motion;

export function personColors(c: ThemeColors, isMe: boolean) {
  return isMe
    ? { fill: c.you, text: c.youText, tint: c.youTint, on: c.onYou }
    : { fill: c.partner, text: c.partnerText, tint: c.partnerTint, on: c.onPartner };
}
