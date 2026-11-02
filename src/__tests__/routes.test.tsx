import { renderRouter, screen } from 'expo-router/testing-library';

// Boot smoke test for the real app/ tree: Expo Router throws on duplicate URL paths
// and missing layouts, so rendering every route here is our stand-in for a
// simulator boot until the dev environment is fixed.
const APP_DIR = './app';

// [url, screen id from design-handoff/screens.json]
const ROUTES: [string, string][] = [
  ['/welcome', '01'],
  ['/story/1', '02-04'],
  ['/quiz/stage', '05'],
  ['/quiz/goals', '06'],
  ['/quiz/names', '07'],
  ['/quiz/dates', '47'],
  ['/sign-in', '08'],
  ['/invite', '10'],
  ['/waiting', '11'],
  ['/join', '12'],
  ['/paired', '13'],
  ['/reminders', '09'],
  ['/partner-left', '58'],
  ['/join/welcome', 'J2'],
  ['/join/code', 'J3'],
  ['/join/sign-in', 'J4'],
  ['/join/name', 'J5'],
  ['/join/reminders', 'J6'],
  ['/join/full', 'J10'],
  ['/join/done', 'J8'],
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

  it('boots at / and redirects to onboarding', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(r.getPathname()).toBe('/welcome');
    expect(screen.getByText('01')).toBeTruthy();
  });

  it.each(ROUTES)('%s renders screen %s', async (url, id) => {
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    expect(r.getPathname()).toBe(url);
    expect(screen.getByText(id)).toBeTruthy();
  });

  it('shows tab labels and placeholder names from the English catalogue', async () => {
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
