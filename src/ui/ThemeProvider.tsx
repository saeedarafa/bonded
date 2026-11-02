import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import type { ColorScheme, ThemeColors } from './theme';
import { colors as palette, motion, radius, size, space, type } from './theme';

export type Theme = {
  scheme: ColorScheme;
  colors: ThemeColors;
  type: typeof type;
  space: typeof space;
  radius: typeof radius;
  size: typeof size;
  motion: typeof motion;
};

function buildTheme(scheme: ColorScheme): Theme {
  return { scheme, colors: palette[scheme], type, space, radius, size, motion };
}

const ThemeContext = createContext<Theme>(buildTheme('light'));

/** Follows the system light/dark setting; screens read it with `useTheme()`. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = useMemo(() => buildTheme(scheme), [scheme]);
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    const c = theme.colors;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: c.you,
        background: c.bg,
        card: c.surface,
        text: c.text,
        border: c.line,
        notification: c.blush,
      },
    };
  }, [scheme, theme.colors]);

  return (
    <ThemeContext.Provider value={theme}>
      <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Render a subtree in a fixed scheme (gallery shows light and dark side by side). */
export function SchemeOverride({ scheme, children }: { scheme: ColorScheme; children: ReactNode }) {
  const theme = useMemo(() => buildTheme(scheme), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * Scales every type token (size and line height) for a subtree. The OS does this for real users
 * (Dynamic Type / font scale up to 200%, DESIGN.md §3); this lets the gallery and tests look at
 * 200% without changing device settings. Don't combine it with an OS scale in the same view.
 */
export function FontScaleOverride({ scale, children }: { scale: number; children: ReactNode }) {
  const parent = useTheme();
  const theme = useMemo<Theme>(
    () => ({
      ...parent,
      type: Object.fromEntries(
        Object.entries(parent.type).map(([name, style]) => [
          name,
          {
            ...style,
            ...(style.fontSize !== undefined && { fontSize: style.fontSize * scale }),
            ...(style.lineHeight !== undefined && { lineHeight: style.lineHeight * scale }),
          },
        ]),
      ) as Theme['type'],
    }),
    [parent, scale],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
