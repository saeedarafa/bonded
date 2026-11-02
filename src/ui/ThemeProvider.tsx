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
