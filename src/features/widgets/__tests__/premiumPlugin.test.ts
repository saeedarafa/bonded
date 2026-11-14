import type { ExpoConfig } from 'expo/config';

import { WIDGET_TOKEN_KEY, WIDGET_TOKEN_SERVICE } from '../tokens';

/**
 * MOB-77 (D59, SEC-21 option A): the premium half of the widgets config plugin. Behind the
 * `premium` prop: the shared keychain access group for the widget token (app + extension), the
 * Info.plist key the bridge module surfaces as `keychainAccessGroup`, the Supabase URL for the
 * extension and the premium Swift sources. Off by default, so today's builds never mint.
 * Also the JS ⇄ native bridge contract (names the JS calls exist in the Swift and Kotlin modules,
 * keys match on both sides). The Swift is not compiled here (it is typechecked with swiftc, see
 * plugins/widgets/README.md; a device build is still needed).
 */

type Mod = (c: Record<string, unknown>) => Promise<{ modResults: Record<string, unknown> }>;
type WithMods = ExpoConfig & { mods?: { ios?: Record<string, Mod> } };
type XcodeProject = {
  parseSync(): XcodeProject;
  writeSync(): string;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
const plugin = require('../../../../plugins/widgets') as {
  (config: ExpoConfig, props?: Record<string, unknown>): WithMods;
  addWidgetTarget(project: XcodeProject, o: unknown): XcodeProject;
  iosFiles(o: unknown): Record<string, string>;
  options(config: ExpoConfig, props?: Record<string, unknown>): Record<string, unknown>;
  appKeychainGroups(existing: string[] | undefined, o: unknown): string[];
  swiftPremiumCopy(en: unknown): string;
  IOS_PREMIUM_SWIFT: string[];
};
const xcode = require('xcode') as { project(file: string): XcodeProject };
/* eslint-enable @typescript-eslint/no-require-imports */

const FIXTURE = 'src/features/widgets/__tests__/fixtures/template.pbxproj';
const GROUP = '$(AppIdentifierPrefix)com.hellobonded.app.widget';
const URL = 'https://example.supabase.co';
const PREMIUM = { premium: true, supabaseUrl: URL };
const read = (p: string) => fs.readFileSync(p, 'utf8');
const PREMIUM_DIR = 'plugins/widgets/ios/premium';
const MODULE_SWIFT = 'plugins/widgets/modules/bonded-widgets/ios/BondedWidgetsModule.swift';
const MODULE_KT =
  'plugins/widgets/modules/bonded-widgets/android/src/main/java/com/hellobonded/widgets/BondedWidgetsModule.kt';

const base = (): ExpoConfig => ({
  name: 'Bonded',
  slug: 'bonded',
  version: '1.0.0',
  ios: { bundleIdentifier: 'com.hellobonded.app' },
  android: { package: 'com.hellobonded.app' },
});

async function runIosMod(config: WithMods, mod: string, modResults: Record<string, unknown>) {
  const fn = config.mods?.ios?.[mod];
  if (!fn) throw new Error(`no ios.${mod} mod`);
  const out = await fn({
    ...config,
    modResults,
    modRequest: { platform: 'ios', projectRoot: '.', platformProjectRoot: 'ios' },
  });
  return out.modResults;
}

describe('widgets plugin: premium off (default, today)', () => {
  it('adds no keychain group, no Info.plist key and no premium sources', async () => {
    const config = plugin(base());
    const ent = await runIosMod(config, 'entitlements', {});
    expect(ent['keychain-access-groups']).toBeUndefined();
    const info = await runIosMod(config, 'infoPlist', { BondedWidgetKeychainGroup: 'stale' });
    expect(info.BondedWidgetKeychainGroup).toBeUndefined();
    expect(info.BondedAppGroup).toBe('group.com.hellobonded.app');

    const files = plugin.iosFiles(plugin.options(base()));
    expect(files['BondedWidgetExtension.entitlements']).not.toContain('keychain-access-groups');
    expect(files['BondedWidgetExtension-Info.plist']).not.toContain('BondedWidgetKeychainGroup');
    expect(files['BondedWidgetExtension-Info.plist']).not.toContain('BondedSupabaseURL');
    for (const name of plugin.IOS_PREMIUM_SWIFT) expect(files[name]).toBeUndefined();
    expect(files['BondedWidgets.swift']).not.toContain('BONDED_PREMIUM_WIDGETS');
    expect(files['BondedWidgets.swift']).not.toContain('BondedLittleThingsWidget');

    const text = plugin.addWidgetTarget(xcode.project(FIXTURE).parseSync(), plugin.options(base()));
    expect(text.writeSync()).not.toContain('WidgetTokenStore.swift');
  });

  it('app.config registers the plugin without premium', () => {
    expect(read('app.config.ts')).toMatch(/^\s*'\.\/plugins\/widgets',$/m);
  });
});

describe('widgets plugin: premium on', () => {
  it('needs the Supabase URL (origin only)', () => {
    expect(() => plugin.options(base(), { premium: true })).toThrow('supabaseUrl');
    expect(() =>
      plugin.options(base(), { premium: true, supabaseUrl: `${URL}/functions/v1` }),
    ).toThrow('supabaseUrl');
    expect(plugin.options(base(), { premium: true, supabaseUrl: `${URL}/` }).supabaseUrl).toBe(URL);
  });

  it('SEC Info 1: needs https, plain http only for a local Supabase', () => {
    const opts = (supabaseUrl: string) => plugin.options(base(), { premium: true, supabaseUrl });
    for (const bad of [
      'http://example.supabase.co',
      'http://192.168.1.10:54321',
      'http://localhost.evil.com',
      'http://user@localhost',
      'ftp://example.supabase.co',
      'https://',
    ])
      expect(() => opts(bad)).toThrow('https://');
    for (const ok of [
      'https://example.supabase.co',
      'https://example.supabase.co:8443',
      'http://localhost:54321',
      'http://127.0.0.1:54321',
      'http://10.0.2.2:54321',
      'http://LOCALHOST:54321',
    ])
      expect(opts(ok).supabaseUrl).toBe(ok);
    // Premium off: the URL is not used, so it is not checked.
    expect(plugin.options(base(), { supabaseUrl: 'http://example.com' }).supabaseUrl).toBe('');
  });

  it('gives the app its own keychain group first, then the widget group (keeps others)', async () => {
    const config = plugin(base(), PREMIUM);
    const ent = await runIosMod(config, 'entitlements', {
      'keychain-access-groups': ['$(AppIdentifierPrefix)com.example.other', GROUP],
    });
    expect(ent['keychain-access-groups']).toEqual([
      '$(AppIdentifierPrefix)com.hellobonded.app',
      '$(AppIdentifierPrefix)com.example.other',
      GROUP,
    ]);
    expect(ent['com.apple.security.application-groups']).toEqual(['group.com.hellobonded.app']);
    // Idempotent.
    const o = plugin.options(base(), PREMIUM);
    const once = plugin.appKeychainGroups(undefined, o);
    expect(plugin.appKeychainGroups(once, o)).toEqual(once);
  });

  it('surfaces the group in the app Info.plist (the bridge reads it as keychainAccessGroup)', async () => {
    const info = await runIosMod(plugin(base(), PREMIUM), 'infoPlist', {});
    expect(info.BondedWidgetKeychainGroup).toBe(GROUP);
    const swift = read(MODULE_SWIFT);
    expect(swift).toContain('Constant("keychainAccessGroup")');
    expect(swift).toContain('forInfoDictionaryKey: "BondedWidgetKeychainGroup"');
    // An unexpanded `$(AppIdentifierPrefix)` must read as "no group" (the app then never mints).
    expect(swift).toContain('!group.contains("$(")');
  });

  it('SEC L1: iOS advertises a token reader exactly when the keychain group is set; Android when the premium receivers are built (MOB-78)', () => {
    const swift = read(MODULE_SWIFT);
    expect(swift).toContain('Constant("hasTokenReader")');
    expect(swift).toMatch(
      /Constant\("hasTokenReader"\) \{ \(\) -> Bool in\s*BondedWidgetsModule\.keychainGroup != nil/,
    );
    const kt = read(MODULE_KT);
    expect(kt).toMatch(
      /Constant\("hasTokenReader"\) \{\s*appContext\.reactContext\?\.let \{ hasTokenReader\(it\) \} \?: false/,
    );
    expect(kt).toContain('const val TOKEN_READER_META = "com.hellobonded.widgets.TOKEN_READER"');
    expect(kt).toContain('metaData?.getBoolean(TOKEN_READER_META, false) == true');
    expect(read('src/features/widgets/bridge.ts')).toContain('hasTokenReader?: boolean');
  });

  it('gives the extension only the widget group, the URL and the premium sources', () => {
    const files = plugin.iosFiles(plugin.options(base(), PREMIUM));
    const ent = files['BondedWidgetExtension.entitlements']!;
    expect(ent).toMatch(
      /<key>keychain-access-groups<\/key>\s*<array>\s*<string>\$\(AppIdentifierPrefix\)com\.hellobonded\.app\.widget<\/string>\s*<\/array>/,
    );
    expect(ent).not.toContain('$(AppIdentifierPrefix)com.hellobonded.app</string>');
    const info = files['BondedWidgetExtension-Info.plist']!;
    expect(info).toMatch(
      /<key>BondedWidgetKeychainGroup<\/key>\s*<string>\$\(AppIdentifierPrefix\)/,
    );
    expect(info).toMatch(
      /<key>BondedSupabaseURL<\/key>\s*<string>https:\/\/example\.supabase\.co</,
    );
    for (const name of plugin.IOS_PREMIUM_SWIFT) expect(files[name]).toBeTruthy();
    expect(files['BondedWidgets.swift']).toContain('BondedLittleThingsWidget()');
    expect(files['BondedWidgets.swift']).toContain('BondedLockQuestionWidget()');
    expect(files['BondedWidgets.swift']).toContain('BondedLockSendWidget()');
    // The control needs iOS 18, inside its own availability block (the bundle runs from 16.4/17).
    expect(files['BondedWidgets.swift']).toMatch(
      /if #available\(iOSApplicationExtension 18\.0, \*\) \{\s*BondedSendHugControl\(\)\s*\}/,
    );
    expect(files['BondedWidgets.swift']).not.toContain('BONDED_PREMIUM_WIDGETS');

    const text = plugin
      .addWidgetTarget(xcode.project(FIXTURE).parseSync(), plugin.options(base(), PREMIUM))
      .writeSync();
    for (const name of plugin.IOS_PREMIUM_SWIFT) expect(text).toContain(`${name} in Sources`);
  });

  it('EAS signs the extension with the keychain group too', () => {
    const config = plugin(base(), PREMIUM);
    expect(config.extra?.eas?.build?.experimental?.ios?.appExtensions).toEqual([
      {
        targetName: 'BondedWidgetExtension',
        bundleIdentifier: 'com.hellobonded.app.widgets',
        entitlements: {
          'com.apple.security.application-groups': ['group.com.hellobonded.app'],
          'keychain-access-groups': [GROUP],
        },
      },
    ]);
  });
});

describe('widgets bridge: JS ⇄ native contract', () => {
  it('both native modules have what src/features/widgets/bridge.ts calls', () => {
    const bridge = read('src/features/widgets/bridge.ts');
    for (const name of ['setSnapshot', 'takeActionQueue']) {
      expect(bridge).toContain(`${name}`);
      expect(read(MODULE_SWIFT)).toContain(`Function("${name}")`);
      expect(read(MODULE_KT)).toContain(`Function("${name}")`);
    }
    expect(bridge).toContain("requireOptionalNativeModule<BondedWidgetsModule>('BondedWidgets')");
    expect(read(MODULE_SWIFT)).toContain('Name("BondedWidgets")');
    expect(read(MODULE_KT)).toContain('Name("BondedWidgets")');
  });

  it('the action queue key is the same in the app module and the extension', () => {
    expect(read(MODULE_SWIFT)).toContain('static let actionsKey = "bonded.widget.actions"');
    expect(read(`${PREMIUM_DIR}/WidgetActionQueue.swift`)).toContain(
      'static let key = "bonded.widget.actions"',
    );
    expect(read(MODULE_KT)).toContain('const val ACTIONS_KEY = "actions"');
  });

  it('the extension reads the keychain item tokens.ts writes (expo-secure-store layout)', () => {
    const store = read(`${PREMIUM_DIR}/WidgetTokenStore.swift`);
    // expo-secure-store appends ":no-auth" to the service and stores the key as Data.
    expect(store).toContain(`static let service = "${WIDGET_TOKEN_SERVICE}:no-auth"`);
    expect(store).toContain(`static let account = Data("${WIDGET_TOKEN_KEY}".utf8)`);
    expect(store).toContain('kSecAttrAccessGroup');
    expect(store).not.toMatch(/SecItemAdd|SecItemUpdate|SecItemDelete/); // read only, never mints
    expect(read('src/features/widgets/tokens.ts')).toContain(
      'keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    );
  });

  it('the token never touches the App Group (snapshot, queue, module)', () => {
    for (const file of [
      MODULE_SWIFT,
      MODULE_KT,
      'plugins/widgets/ios/BondedSnapshot.swift',
      `${PREMIUM_DIR}/WidgetActionQueue.swift`,
    ]) {
      const src = read(file);
      expect(src).not.toMatch(/bwt_|Bearer|WidgetTokenStore|kSecClass/);
    }
    const store = read(`${PREMIUM_DIR}/WidgetTokenStore.swift`);
    expect(store).not.toMatch(/UserDefaults|suiteName/);
    const client = read(`${PREMIUM_DIR}/WidgetClient.swift`);
    expect(client).not.toMatch(/UserDefaults|print\(|NSLog|os_log|Logger\(/);
  });
});

describe('widgets plugin: premium copy and intents', () => {
  const en = JSON.parse(read('src/i18n/locales/en.json')) as { widgets: Record<string, unknown> };

  it('generates the widgets.* copy table from en.json', () => {
    const swift = plugin.swiftPremiumCopy(en);
    expect(swift).toContain('"littleThings.tapToSend": "Tap to send",');
    expect(swift).toContain('"thinking.gotLocked.hug": "A hug for you · {{time}}",');
    expect(() => plugin.swiftPremiumCopy({})).toThrow('widgets');
    expect(plugin.swiftPremiumCopy({ widgets: { a: 'say "hi"\\' } })).toContain(
      '"a": "say \\"hi\\"\\\\",',
    );
  });

  it('every copy key the premium Swift uses exists in en.json', () => {
    const flat = new Set<string>();
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [k, v] of Object.entries(node)) {
        const name = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') flat.add(name);
        else if (v && typeof v === 'object') walk(v as Record<string, unknown>, name);
      }
    };
    walk(en.widgets, '');
    const used = new Set<string>();
    for (const name of [
      'LittleThingsWidget.swift',
      'LittleThingsIntents.swift',
      'LockScreenWidgets.swift',
      'LockScreenSend.swift',
      'WidgetClient.swift',
    ]) {
      for (const m of read(`${PREMIUM_DIR}/${name}`).matchAll(/BondedCopy\.t\("([^"]+)"/g))
        used.add(m[1]!);
      for (const m of read(`${PREMIUM_DIR}/${name}`).matchAll(/BondedCopy\.plural\("([^"]+)"/g)) {
        used.add(`${m[1]!}_one`);
        used.add(`${m[1]!}_other`);
      }
    }
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((k) => !flat.has(k))).toEqual([]);
  });

  it('App Intents never open the app, stay out of Shortcuts and need an unlocked phone', () => {
    const intents = read(`${PREMIUM_DIR}/LittleThingsIntents.swift`);
    const structs = [...intents.matchAll(/struct (\w+): AppIntent/g)].map((m) => m[1]);
    expect(structs.sort()).toEqual([
      'SendHugControlIntent',
      'SendLittleThingIntent',
      'UndoLittleThingIntent',
    ]);
    for (const rule of [
      'static let openAppWhenRun: Bool = false',
      'static let isDiscoverable: Bool = false',
      'static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication',
    ])
      expect(intents.split(rule).length - 1).toBe(structs.length);
    // Every surface sends through the one path (new client_id per tap, one same-id retry).
    expect(intents.match(/WidgetClient\.send\(/g)).toHaveLength(2);
    expect(intents).toMatch(
      /struct SendLittleThingIntent[\s\S]*?LittleThingsSender\.send\(kind: kind\)/,
    );
    expect(intents).toMatch(
      /struct SendHugControlIntent[\s\S]*?LittleThingsSender\.send\(kind: "hug"\)/,
    );
  });

  it('Lock Screen / Control Center send: unlock first, hug only, no name, no question (SEC-21 default)', () => {
    const send = read(`${PREMIUM_DIR}/LockScreenSend.swift`);
    // Only the intents above, so `.requiresAuthentication` always applies; no intent defined here.
    expect(send).not.toMatch(/: AppIntent\b/);
    expect(
      [...send.matchAll(/Button\(intent: (\w+)\(([^)]*)\)/g)].map((m) => `${m[1]}(${m[2]})`),
    ).toEqual(['SendLittleThingIntent(kind: "hug")']);
    expect([...send.matchAll(/ControlWidgetButton\(action: (\w+)\(\)/g)].map((m) => m[1])).toEqual([
      'SendHugControlIntent',
    ]);
    // Never the partner's name or the question while the phone may be locked.
    const code = send.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/partner_first_name|today\?\.|question|\["partner"/);
    // Lock Screen family only, iOS 18 for the control.
    expect(send.match(/supportedFamilies\(\[([^\]]*)\]\)/)?.[1]).toBe('.accessoryCircular');
    expect(send).toMatch(
      /@available\(iOS 18\.0, \*\)\s*struct BondedSendHugControl: ControlWidget/,
    );
    // A sent hug reloads every surface that shows it.
    const intents = read(`${PREMIUM_DIR}/LittleThingsIntents.swift`);
    expect(intents).toContain('reloadTimelines(ofKind: BondedLockSendWidget.kind)');
    expect(intents).toContain(
      'ControlCenter.shared.reloadControls(ofKind: BondedSendHugControl.kind)',
    );
  });

  it('Lock Screen widgets never send and hide the private lines (SEC-21 Info 5)', () => {
    const lock = read(`${PREMIUM_DIR}/LockScreenWidgets.swift`);
    expect(lock).not.toMatch(/Button\(intent:|AppIntent|ControlWidget/);
    expect(lock).toContain('.privacySensitive()');
    expect(lock).toContain('redactionReasons');
    const little = read(`${PREMIUM_DIR}/LittleThingsWidget.swift`);
    // SEC Info 2: the Home Screen widget also shows in StandBy on a locked phone: the partner's
    // name is privacySensitive, with neutral lines (no name) when redacted.
    expect(little).toContain('@Environment(\\.redactionReasons)');
    expect(little).toMatch(/if redacted \{ return BondedCopy\.t\("lockSend\.name"\) \}/);
    expect(little).toMatch(/if redacted \{\s*Text\(BondedCopy\.t\("lockSend\.sent"\)\)/);
    expect(little).toMatch(
      /"littleThings\.sent", \["partner": partner\]\)\)[\s\S]{0,200}?\.privacySensitive\(\)/,
    );
    expect(little).toContain('.privacySensitive(sensitive)');
    // The send buttons live only on Home Screen sizes, never on accessory (Lock Screen) families.
    const families = little.match(/supportedFamilies\(\[([^\]]*)\]\)/)?.[1] ?? '';
    expect(families).toContain('.systemSmall');
    expect(families).not.toContain('accessory');
  });
});
