import type { ExpoConfig } from 'expo/config';

/**
 * MOB-78, SEC-21 "MOB-78 (Android) acceptance checks" 1: the widget token lives in
 * expo-secure-store's private prefs (`SecureStore.xml`, AES-256-GCM with a Keystore key) and those
 * prefs are excluded from Auto Backup (Android 11 and lower) and from cloud backup and device
 * transfer (Android 12+). SEC-25 Info 1: the same rules also exclude every `bonded_widget*` prefs
 * file the widget Kotlin opens; plugins/widgets writes the rules, secure-store's own are off. No prebuild: this runs every config plugin of app.config.ts through
 * @expo/config-plugins on an in-memory manifest, then reads the rule files the manifest points at.
 */

type Application = {
  $: Record<string, string>;
  activity?: unknown[];
  receiver?: { $: Record<string, string> }[];
};
type Manifest = { manifest: { $: Record<string, string>; application: Application[] } };
type ModConfig = ExpoConfig & { modResults: unknown; modRequest: Record<string, unknown> };
type Mod = (config: ModConfig) => Promise<ModConfig>;

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  readFileSync: (p: string, enc: 'utf8') => string;
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => { name: string; isDirectory(): boolean }[];
};
const { withPlugins } = require('expo/config-plugins') as {
  withPlugins: (config: ExpoConfig, plugins: unknown[]) => ExpoConfig & { mods?: unknown };
};

const ROOT = process.cwd();
const plugin = require('../../../../plugins/widgets') as {
  androidFiles(o: unknown): Record<string, string>;
  options(config: ExpoConfig, props?: Record<string, unknown>): Record<string, unknown>;
  ANDROID_BACKUP_EXCLUDED_PREFS: string[];
};
/** Every Kotlin source the widgets ship (home widgets, premium widgets, bridge module). */
const KOTLIN_DIRS = [
  'plugins/widgets/android/kotlin',
  'plugins/widgets/android/premium/kotlin',
  'plugins/widgets/modules/bonded-widgets/android/src/main/java',
];
/* eslint-enable @typescript-eslint/no-require-imports */

function appConfig(): ExpoConfig {
  let config: ExpoConfig | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../../app.config') as {
      default: (ctx: { config: Partial<ExpoConfig> }) => ExpoConfig;
    };
    config = mod.default({ config: {} });
  });
  return config as ExpoConfig;
}

/** The manifest Expo's template starts from (only the parts these plugins look at). */
function templateManifest(extra: Record<string, string> = {}): Manifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: {
            'android:name': '.MainApplication',
            'android:allowBackup': 'true',
            ...extra,
          },
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [
                {
                  action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
                  category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Applies every plugin of app.config.ts, then runs the Android manifest mod chain. */
async function prebuiltManifest(start: Manifest): Promise<Manifest> {
  const base = appConfig();
  const config = withPlugins(
    { ...base, _internal: { projectRoot: ROOT } } as ExpoConfig,
    base.plugins ?? [],
  ) as ExpoConfig & { mods?: { android?: { manifest?: Mod } } };
  const mod = config.mods?.android?.manifest;
  if (!mod) throw new Error('no android.manifest mod');
  const result = await mod({
    ...config,
    modResults: start,
    modRequest: {
      projectRoot: ROOT,
      platformProjectRoot: `${ROOT}/android`,
      platform: 'android',
      modName: 'manifest',
      introspect: true,
    },
  });
  return result.modResults as Manifest;
}

function kotlinFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? kotlinFiles(`${dir}/${e.name}`)
        : e.name.endsWith('.kt')
          ? [`${dir}/${e.name}`]
          : [],
    );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolves one part of a `getSharedPreferences(...)` name: a string literal, `Owner.NAME` (the
 * first `const val NAME` after `object|class Owner`) or a bare `NAME` (the nearest `const val NAME`
 * before the call, else the first after it: Kotlin scopes). Throws on anything else, so a new way of
 * naming a prefs file fails the test instead of slipping past it.
 */
function resolvePart(source: string, part: string, at: number, where: string): string {
  const literal = /^"([^"]*)"$/.exec(part);
  if (literal) return literal[1]!;
  const constant = (name: string) => new RegExp(`const val ${escape(name)}\\s*=\\s*"([^"]*)"`, 'g');
  const qualified = /^([A-Za-z_]\w*)\.([A-Z_][A-Z0-9_]*)$/.exec(part);
  if (qualified) {
    const owner = new RegExp(`\\b(?:object|class)\\s+${qualified[1]}\\b`).exec(source);
    if (owner) {
      const re = constant(qualified[2]!);
      re.lastIndex = owner.index;
      const m = re.exec(source);
      if (m) return m[1]!;
    }
  }
  if (/^[A-Z_][A-Z0-9_]*$/.test(part)) {
    const all = [...source.matchAll(constant(part))];
    const before = all.filter((m) => m.index! < at).pop();
    const found = before ?? all.find((m) => m.index! > at);
    if (found) return found[1]!;
  }
  throw new Error(`cannot resolve prefs name part "${part}" in ${where}`);
}

/** Every SharedPreferences file name opened in the given Kotlin source. */
function prefsNamesIn(source: string, where: string): string[] {
  const names: string[] = [];
  for (const call of source.matchAll(/getSharedPreferences\(/g)) {
    // The first argument: up to the first comma outside nested parentheses.
    let depth = 0;
    let end = call.index! + call[0].length;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '(') depth++;
      else if (ch === ')' && depth-- === 0) break;
      else if (ch === ',' && depth === 0) break;
    }
    const arg = source.slice(call.index! + call[0].length, end);
    const parts = arg.split('+').map((p) => p.trim());
    names.push(parts.map((p) => resolvePart(source, p, call.index!, where)).join(''));
  }
  return names;
}

/** The prefs files the widget Kotlin actually uses, read from the sources (not a hand list). */
function prefsFilesUsed(): string[] {
  const names = KOTLIN_DIRS.flatMap(kotlinFiles).flatMap((f) =>
    prefsNamesIn(fs.readFileSync(f, 'utf8'), f),
  );
  return [...new Set(names)].sort();
}

/** The two rule files the widget plugin writes into android/app/src/main/res/xml. */
function writtenRules(props: Record<string, unknown>): (ref: string) => string {
  const files = plugin.androidFiles(plugin.options(appConfig(), props));
  return (ref: string) => {
    const match = /^@xml\/([a-z_]+)$/.exec(ref);
    if (!match) throw new Error(`not an @xml reference: ${ref}`);
    const xml = files[`res/xml/${match[1]}.xml`];
    if (!xml) throw new Error(`the widget plugin does not write ${ref}`);
    return xml;
  };
}

/** `<exclude domain="sharedpref" path="NAME"/>` (or `NAME.xml`) inside the given XML (or section). */
const excludes = (xml: string, name: string) =>
  new RegExp(`<exclude\\s+domain="sharedpref"\\s+path="${escape(name)}(\\.xml)?"\\s*/>`).test(xml);
/** The only include is the sharedpref domain (the same scope expo-secure-store's rules had). */
const includes = (xml: string) => [...xml.matchAll(/<include\s[^>]*\/>/g)].map((m) => m[0]);

const section = (xml: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? '';

describe('Android backup exclusion for the widget token and widget prefs (MOB-78, SEC-21 check 1, SEC-25 Info 1)', () => {
  const used = prefsFilesUsed();

  it('finds every prefs file the widget Kotlin opens, SecureStore included', () => {
    expect(used).toEqual(
      expect.arrayContaining([
        'SecureStore',
        'bonded_widgets',
        'bonded_widget_little_things',
        'bonded_widget_days_together',
        'bonded_widget_days_together_seen',
        'bonded_widget_streak',
        'bonded_widget_streak_seen',
      ]),
    );
  });

  it('the plugin excludes exactly the prefs files the Kotlin uses', () => {
    expect([...plugin.ANDROID_BACKUP_EXCLUDED_PREFS].sort()).toEqual(used);
  });

  it('the resolver catches a new prefs file and refuses names it cannot read', () => {
    const planted = `object NewCache {\n  const val PREFS = "bonded_widget_new"\n}\nfun f(c: Context) = c.getSharedPreferences(NewCache.PREFS + "_seen", 0)`;
    expect(prefsNamesIn(planted, 'planted')).toEqual(['bonded_widget_new_seen']);
    expect(plugin.ANDROID_BACKUP_EXCLUDED_PREFS).not.toContain('bonded_widget_new_seen');
    expect(() => prefsNamesIn('c.getSharedPreferences(name(), 0)', 'planted')).toThrow(
      /cannot resolve/,
    );
  });

  it('registers expo-secure-store without its own backup rules and without Face ID', () => {
    const entry = appConfig().plugins?.find(
      (p) => (Array.isArray(p) ? p[0] : p) === 'expo-secure-store',
    );
    expect(entry).toEqual([
      'expo-secure-store',
      { configureAndroidBackup: false, faceIDPermission: false },
    ]);
  });

  it.each([
    ['the plain template', {}],
    [
      'a template that still points at the secure-store rules',
      {
        'android:fullBackupContent': '@xml/secure_store_backup_rules',
        'android:dataExtractionRules': '@xml/secure_store_data_extraction_rules',
      },
    ],
  ])(
    'the merged manifest points at rules that exclude every prefs file (%s)',
    async (_n, extra) => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const manifest = await prebuiltManifest(templateManifest(extra));
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('backup'))).toEqual([]);
      warn.mockRestore();
      const app = manifest.manifest.application[0]!.$;
      expect(app['android:allowBackup']).toBe('true');
      expect(app['android:fullBackupContent']).toBe('@xml/bonded_backup_rules');
      expect(app['android:dataExtractionRules']).toBe('@xml/bonded_data_extraction_rules');

      for (const props of [{}, { premium: true, supabaseUrl: 'https://example.supabase.co' }]) {
        const rule = writtenRules(props);
        // Android 11 and lower: Auto Backup.
        const full = rule(app['android:fullBackupContent']!);
        expect(full).toContain('<full-backup-content>');
        expect(includes(full)).toEqual(['<include domain="sharedpref" path="."/>']);
        // Android 12+: both cloud backup and device-to-device transfer.
        const extraction = rule(app['android:dataExtractionRules']!);
        for (const xml of [
          section(extraction, 'cloud-backup'),
          section(extraction, 'device-transfer'),
        ])
          expect(includes(xml)).toEqual(['<include domain="sharedpref" path="."/>']);
        for (const name of used) {
          expect([name, excludes(full, name)]).toEqual([name, true]);
          expect([name, excludes(section(extraction, 'cloud-backup'), name)]).toEqual([name, true]);
          expect([name, excludes(section(extraction, 'device-transfer'), name)]).toEqual([
            name,
            true,
          ]);
        }
      }
    },
  );

  it('keeps the widget receivers private in the same manifest', async () => {
    const manifest = await prebuiltManifest(templateManifest());
    const receivers = manifest.manifest.application[0]!.receiver ?? [];
    const widgets = receivers.filter((r) => r.$['android:name']!.includes('.widget.'));
    expect(widgets.length).toBeGreaterThanOrEqual(2);
    for (const r of widgets) expect(r.$['android:exported']).toBe('false');
  });

  it('stores the token where the rules exclude it: expo-secure-store prefs file "SecureStore"', () => {
    // If expo-secure-store ever renames its prefs file, the exclusion above silently stops covering
    // the token. Pin the name the library writes to.
    const source = fs.readFileSync(
      'node_modules/expo-secure-store/android/src/main/java/expo/modules/securestore/SecureStoreModule.kt',
      'utf8',
    );
    expect(source).toContain('private const val SHARED_PREFERENCES_NAME = "SecureStore"');
    expect(source).toContain('Context.MODE_PRIVATE');
  });
});
