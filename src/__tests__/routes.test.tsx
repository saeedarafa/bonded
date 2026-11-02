import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { usePendingInvite } from '@/features/auth/pendingInvite';

// The auth gate reads the session through `features/auth/api` and the couple through
// `features/couple/api` (the only Supabase touchpoints), so both are controlled here.
let mockUser: { userId: string } | null = null;
let mockCouple: object | null = { id: 'couple-1' };
jest.mock('@/features/auth/api', () => ({
  subscribeToSession: (listener: (u: { userId: string } | null) => void) => {
    listener(mockUser);
    return () => undefined;
  },
  isAppleSignInAvailable: () => Promise.resolve(false),
}));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () => Promise.resolve(mockCouple),
  unpair: () => Promise.resolve(),
}));

// Boot smoke test for the real app/ tree: Expo Router throws on duplicate URL paths
// and missing layouts, so rendering every route here is our stand-in for a
// simulator boot until the dev environment is fixed.
const APP_DIR = './app';

// [url, screen id from design-handoff/screens.json]
// Reachable signed out (onboarding, sign-in, the join flow).
const PUBLIC_ROUTES: [string, string][] = [
  ['/welcome', '01'],
  ['/story/1', '02-04'],
  ['/quiz/stage', '05'],
  ['/quiz/goals', '06'],
  ['/quiz/names', '07'],
  ['/quiz/dates', '47'],
  ['/join/welcome', 'J2'],
  ['/join/code', 'J3'],
  ['/join/name', 'J5'],
  ['/join/reminders', 'J6'],
  ['/join/full', 'J10'],
  ['/join/done', 'J8'],
];

// Signed in only (the auth gate, MOB-08).
const PROTECTED_ROUTES: [string, string][] = [
  ['/invite', '10'],
  ['/waiting', '11'],
  ['/join', '12'],
  ['/paired', '13'],
  ['/reminders', '09'],
  ['/partner-left', '58'],
  ['/today', '18'],
  ['/today/answer', '19'],
  ['/today/reveal', '20'],
  ['/today/revealed', '21'],
  ['/today/thread', '22'],
  ['/history', '29'],
  ['/history/q-123', '30'],
  ['/history/recap', '31'],
  ['/packs', '32'],
  ['/packs/p-1', '33'],
  ['/us', '40'],
  ['/us/notifications', '41'],
  ['/us/couple', '42'],
  ['/us/delete', '43'],
  ['/us/badges', '52'],
  ['/us/feedback', '27'],
  ['/paywall', '16'],
  ['/success', '35'],
  ['/gift', '14'],
  ['/gift/opened', '15'],
  ['/milestone/7', '25'],
];

// The first renderRouter() loads and transforms the whole app module graph (every route, the data
// layer, the UI library, the gallery). With a cold Jest cache (fresh CI runner, `npm ci`) that took
// 6 to 20 s inside the first test and tripped its 5 s timeout. Do it once in a hook with a limit
// sized for a cold cache; each test then only measures routing and rendering.
const COLD_START_MS = 90_000;

describe('app routes', () => {
  beforeAll(async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
  }, COLD_START_MS);

  beforeEach(() => {
    mockUser = null;
    mockCouple = { id: 'couple-1' };
    usePendingInvite.getState().clear();
  });

  it('boots at / and redirects to onboarding when signed out', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    expect(screen.getByText('01')).toBeTruthy();
  });

  it('sends a signed-in person with a couple to Today', async () => {
    mockUser = { userId: 'u1' };
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/today'));
  });

  it('sends a signed-in person without a couple to the invite step', async () => {
    mockUser = { userId: 'u1' };
    mockCouple = null;
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/invite'));
  });

  it.each(PUBLIC_ROUTES)('%s renders screen %s (signed out)', async (url, id) => {
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    expect(r.getPathname()).toBe(url);
    expect(screen.getByText(id)).toBeTruthy();
  });

  it.each(PROTECTED_ROUTES)('%s renders screen %s (signed in)', async (url, id) => {
    mockUser = { userId: 'u1' };
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    expect(r.getPathname()).toBe(url);
    expect(screen.getByText(id)).toBeTruthy();
  });

  it.each(PROTECTED_ROUTES.map(([url]) => url))('%s is closed when signed out', async (url) => {
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
  });

  it.each([
    ['/sign-in', '08'],
    ['/join/sign-in', 'J4'],
  ])('%s renders the sign-in screen %s signed out', async (url, id) => {
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    expect(r.getPathname()).toBe(url);
    expect(screen.getByTestId(`${id}-screen`)).toBeTruthy();
    expect(screen.getByTestId(`${id}-google`)).toBeTruthy();
    expect(screen.getByTestId(`${id}-email`)).toBeTruthy();
  });

  it('opens an invite link on J3 with the code, remembering the token (cold start, signed out)', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz012345';
    const r = await renderRouter(APP_DIR, { initialUrl: `/j/BND4827?t=${token}` });
    await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    expect(r.getSearchParams()).toEqual({ code: '4827' });
    expect(usePendingInvite.getState()).toMatchObject({ code: '4827', token });
    expect(screen.getByText('J3')).toBeTruthy();
  });

  it('opens a malformed invite link on J3 without a code', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/j/nonsense' });
    await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    expect(r.getSearchParams()).toEqual({});
    expect(usePendingInvite.getState().code).toBeNull();
  });

  it('shows tab labels and placeholder names from the English catalogue', async () => {
    mockUser = { userId: 'u1' };
    await renderRouter(APP_DIR, { initialUrl: '/today' });
    for (const label of ['History', 'Packs', 'Us']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText('Today').length).toBe(2); // tab label + placeholder name
    expect(screen.getByLabelText('Placeholder: Today')).toBeTruthy();
  });

  it('serves the dev-only component gallery at /dev/gallery (screen 54)', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/dev/gallery' });
    expect(r.getPathname()).toBe('/dev/gallery');
    expect(screen.getByTestId('gallery')).toBeTruthy();
  });

  it('routes an invite code link with its params', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/join/code?code=ABC123' });
    expect(r.getPathname()).toBe('/join/code');
    expect(r.getSearchParams()).toEqual({ code: 'ABC123' });
  });

  it('maps bonded:// links to app paths the way native does', () => {
    // The jest harness parses initialUrl web-style, so check the native parser directly.
    // Internal module: if an SDK upgrade moves it, update this import.
    const { extractExpoPathFromURL } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-router/build/fork/extractPathFromURL') as {
        extractExpoPathFromURL: (prefixes: string[], url: string) => string;
      };
    expect(extractExpoPathFromURL([], 'bonded://join/code?code=ABC123')).toBe(
      'join/code?code=ABC123',
    );
    expect(extractExpoPathFromURL([], 'bonded://today/reveal')).toBe('today/reveal');
  });
});
