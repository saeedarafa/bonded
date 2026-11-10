// QA-07: the display mode the app renders in (read by the ThemeProvider fake in setup.ts).
export type Mode = { name: string; scheme: 'light' | 'dark'; fontScale: number };

export const MODES: Mode[] = [
  { name: 'light', scheme: 'light', fontScale: 1 },
  { name: 'dark', scheme: 'dark', fontScale: 1 },
  { name: 'light-200', scheme: 'light', fontScale: 2 },
];

export const mode: Mode = { ...MODES[0]! };

export function setMode(next: Mode) {
  Object.assign(mode, next);
}
