import { fallbackLanguage, i18n, pickLanguage, resources, supportedLanguages, t } from '@/i18n';
import en from '@/i18n/locales/en.json';

// Jest runs in Node, but the app tsconfig has no Node types, so type just what we use.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as {
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => { name: string; isDirectory(): boolean }[];
  readFileSync: (p: string, enc: 'utf8') => string;
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

function flatKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flatKeys(v as object, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

const FILES = [...sourceFiles('./app'), ...sourceFiles('./src')];
const KEYS = new Set(flatKeys(en));

describe('i18n', () => {
  it('starts in English with the English catalogue only', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en');
    expect(fallbackLanguage).toBe('en');
    expect(supportedLanguages).toEqual(['en']);
    expect(resources.en.translation).toBe(en);
    expect(pickLanguage()).toBe('en');
  });

  it('t() returns English', () => {
    expect(t('tabs.today')).toBe('Today');
    expect(t('tabs.history')).toBe('History');
    expect(t('tabs.packs')).toBe('Packs');
    expect(t('tabs.us')).toBe('Us');
    expect(t('screens.40')).toBe('Us & settings');
  });

  it('interpolates without HTML-escaping (React escapes)', () => {
    expect(t('placeholder.a11yLabel', { name: 'Us & settings' })).toBe(
      'Placeholder: Us & settings',
    );
  });

  it('has no empty strings in the catalogue', () => {
    const empty = [...KEYS].filter((key) => !String(t(key as never)).trim());
    expect(KEYS.size).toBeGreaterThan(40);
    expect(empty).toEqual([]);
  });

  it('scans the app and src trees', () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  it('every t() key used in app/ and src/ exists in the English catalogue', () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
        found++;
        const key = m[1]!;
        // i18next plurals: `t('x', { count })` resolves `x_one` / `x_other`.
        const plural = KEYS.has(`${key}_one`) && KEYS.has(`${key}_other`);
        if (!KEYS.has(key) && !plural) missing.push(`${file}: ${key}`);
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('every PlaceholderScreen screenId has a name in the catalogue', () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<PlaceholderScreen\s+screenId="([^"]+)"/g)) {
        found++;
        if (!KEYS.has(`screens.${m[1]}`)) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('capitalize formatter', () => {
  it('starts a sentence with the partner fallback in upper case, and leaves it mid-sentence', () => {
    const partner = t('pairing.partnerFallback');
    expect(partner).toBe('your partner');
    expect(t('today.yourTurn.fresh', { partner })).toBe(
      'Answer first. Your partner sees yours once they reply.',
    );
    expect(t('today.yourTurn.solo', { partner })).toBe(
      'Answer first. Your partner sees yours once they join and reply.',
    );
    expect(t('pairing.waiting.title', { partner })).toBe('Waiting for your partner to join');
    expect(t('today.yourTurn.fresh', { partner: 'Sam' })).toBe(
      'Answer first. Sam sees yours once they reply.',
    );
  });
});
