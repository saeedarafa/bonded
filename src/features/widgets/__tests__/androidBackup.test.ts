import type { ExpoConfig } from 'expo/config';

/**
 * MOB-78, SEC-21 "MOB-78 (Android) acceptance checks" 1: the widget token lives in
 * expo-secure-store's private prefs (`SecureStore.xml`, AES-256-GCM with a Keystore key) and those
 * prefs are excluded from Auto Backup (Android 11 and lower) and from cloud backup and device
 * transfer (Android 12+). No prebuild: this runs every config plugin of app.config.ts through
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
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
const { withPlugins } = require('expo/config-plugins') as {
  withPlugins: (config: ExpoConfig, plugins: unknown[]) => ExpoConfig & { mods?: unknown };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const ROOT = process.cwd();
const RULES_DIR = 'node_modules/expo-secure-store/android/src/main/res/xml';

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

const ruleFile = (ref: string) => {
  const match = /^@xml\/([a-z_]+)$/.exec(ref);
  if (!match) throw new Error(`not an @xml reference: ${ref}`);
  return fs.readFileSync(`${RULES_DIR}/${match[1]}.xml`, 'utf8');
};

/** `<exclude domain="sharedpref" path="SecureStore"/>` inside the given XML (or section). */
const excludesSecureStore = (xml: string) =>
  /<exclude\s+domain="sharedpref"\s+path="SecureStore"\s*\/>/.test(xml);

describe('Android backup exclusion for the widget token (MOB-78, SEC-21 check 1)', () => {
  it('registers expo-secure-store with configureAndroidBackup and without Face ID', () => {
    const entry = appConfig().plugins?.find(
      (p) => (Array.isArray(p) ? p[0] : p) === 'expo-secure-store',
    );
    expect(entry).toEqual([
      'expo-secure-store',
      { configureAndroidBackup: true, faceIDPermission: false },
    ]);
  });

  it.each([
    ['the plain template', {}],
    [
      'a template that already points at the secure-store rules',
      {
        'android:fullBackupContent': '@xml/secure_store_backup_rules',
        'android:dataExtractionRules': '@xml/secure_store_data_extraction_rules',
      },
    ],
  ])('points the manifest at rules that exclude SecureStore (%s)', async (_name, extra) => {
    const manifest = await prebuiltManifest(templateManifest(extra));
    const app = manifest.manifest.application[0]!.$;
    expect(app['android:fullBackupContent']).toBe('@xml/secure_store_backup_rules');
    expect(app['android:dataExtractionRules']).toBe('@xml/secure_store_data_extraction_rules');

    // Android 11 and lower: Auto Backup.
    const full = ruleFile(app['android:fullBackupContent']!);
    expect(full).toContain('<full-backup-content>');
    expect(excludesSecureStore(full)).toBe(true);

    // Android 12+: both cloud backup and device-to-device transfer.
    const extraction = ruleFile(app['android:dataExtractionRules']!);
    const section = (name: string) =>
      new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(extraction)?.[1] ?? '';
    expect(excludesSecureStore(section('cloud-backup'))).toBe(true);
    expect(excludesSecureStore(section('device-transfer'))).toBe(true);
  });

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
