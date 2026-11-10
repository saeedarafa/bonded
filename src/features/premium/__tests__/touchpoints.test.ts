import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * D52 / REL BIZ-16: paywall 16 is never shown by itself (not after onboarding, pairing, sign-in or
 * a reveal). It opens only from a Premium touchpoint the person taps. This pins every place in the
 * app that routes to `/paywall`, so a new one (an automatic one in particular) fails here and gets
 * a look. `useEffect` next to a `/paywall` route is never allowed.
 */
const ROOT = join(__dirname, '../../../..');

/** File -> why it may open the paywall (each is a tap on a Premium touchpoint). */
const TOUCHPOINTS: Record<string, string> = {
  'src/features/settings/screens/UsScreen.tsx': 'Us / Settings Premium row (tap)',
  'src/features/recap/screens/WeeklyRecapScreen.tsx': 'weekly recap "full recap" (tap)',
  'src/features/daily/screens/TodayScreen.tsx': 'streak saver card 28 (tap)',
  'src/features/packs/screens/PackPreviewScreen.tsx':
    '33 locked row / Unlock / PREMIUM_REQUIRED -> 34',
  // Retired with the D28 gift and win-back (MOB-64); each is a button the person taps.
  'src/features/premium/screens/GiftOpenedScreen.tsx': '15 "see plans" after the gift ended (tap)',
  'src/features/premium/screens/WinbackScreen.tsx': '36 button (tap)',
  'src/features/premium/components/OfferBuy.tsx': 'offer buy button without a plan (tap)',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const routesToPaywall = (source: string) => /['"`]\/paywall['"`]/.test(source);

describe('16 opens only from Premium touchpoints (D52, BIZ-16)', () => {
  const sources = [...files(join(ROOT, 'app')), ...files(join(ROOT, 'src'))].map((path) => ({
    file: relative(ROOT, path),
    source: readFileSync(path, 'utf8'),
  }));

  it('every route to /paywall is a known touchpoint', () => {
    const found = sources.filter((s) => routesToPaywall(s.source)).map((s) => s.file);
    expect(found.sort()).toEqual(Object.keys(TOUCHPOINTS).sort());
  });

  it('no route to /paywall runs from an effect (nothing opens it by itself)', () => {
    for (const { file, source } of sources.filter((s) => routesToPaywall(s.source))) {
      // Every useEffect body in a touchpoint file must not navigate to the paywall.
      const effects = source.split('useEffect(').slice(1);
      for (const body of effects) {
        const end = body.indexOf('}, [');
        const effect = end === -1 ? body : body.slice(0, end);
        expect({ file, opensPaywall: routesToPaywall(effect) }).toEqual({
          file,
          opensPaywall: false,
        });
      }
    }
  });
});
