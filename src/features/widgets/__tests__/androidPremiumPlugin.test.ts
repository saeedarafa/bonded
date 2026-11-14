import type { ExpoConfig } from 'expo/config';

import { WIDGET_ACTIONS, WIDGET_KINDS } from '@/lib/analytics/catalogue';

import { WIDGET_TOKEN_KEY, WIDGET_TOKEN_SERVICE } from '../tokens';

/**
 * MOB-78 (D59, SEC-21 option A, "MOB-78 (Android) acceptance checks"): the Android half of the
 * premium widgets plugin. Behind `premium`: the Little things provider, its action receiver, the
 * TOKEN_READER meta-data the bridge module reads as `hasTokenReader`, and the Kotlin/resources.
 * The Kotlin is NOT compiled here (no kotlinc/Gradle in CI's Jest job); these tests pin the
 * security rules in its source and the names it shares with expo-secure-store and the app.
 */

type Receiver = {
  $: Record<string, string>;
  'intent-filter'?: { action: { $: Record<string, string> }[] }[];
  'meta-data'?: { $: Record<string, string> }[];
};
type Manifest = {
  manifest: {
    application?: {
      $: Record<string, string>;
      receiver?: Receiver[];
      'meta-data'?: { $: Record<string, string> }[];
    }[];
  };
};

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
const plugin = require('../../../../plugins/widgets') as {
  addWidgetReceivers(manifest: Manifest, o: unknown): Manifest;
  androidFiles(o: unknown): Record<string, string>;
  options(config: ExpoConfig, props?: Record<string, unknown>): Record<string, unknown>;
  kotlinPremiumCopy(en: unknown, androidPackage: string): string;
  ANDROID_TOKEN_READER_META: string;
  REFRESH_ACTION: string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const URL = 'https://example.supabase.co';
const PKG = 'com.hellobonded.app';
const WIDGET_DIR = `java/${PKG.replaceAll('.', '/')}/widget`;
const KT = `${WIDGET_DIR}/BondedLittleThings.kt`;
const COPY_KT = `${WIDGET_DIR}/BondedPremiumCopy.kt`;
const SOURCE = 'plugins/widgets/android/premium/kotlin/BondedLittleThings.kt';
const SECURE_STORE =
  'node_modules/expo-secure-store/android/src/main/java/expo/modules/securestore';
const SENDABLE = ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'];
const read = (p: string) => fs.readFileSync(p, 'utf8');

const base = (): ExpoConfig => ({
  name: 'Bonded',
  slug: 'bonded',
  version: '1.0.0',
  ios: { bundleIdentifier: PKG },
  android: { package: PKG },
});
const premium = () => plugin.options(base(), { premium: true, supabaseUrl: URL });
const free = () => plugin.options(base());

const manifest = (): Manifest => ({
  manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] },
});
const app = (m: Manifest) => m.manifest.application![0]!;
const receiver = (m: Manifest, name: string) =>
  (app(m).receiver ?? []).find((r) => r.$['android:name'] === `${PKG}.widget.${name}`);

/** Kotlin without comments (the comments name the things the code must not do). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The body of a top-level Kotlin `object`/`class` (up to the next top-level declaration). */
function block(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start < 0) throw new Error(`no ${header}`);
  const rest = src.slice(start + header.length);
  const next = rest.search(/\n(?:object|class|sealed class|private const|\/\*\*\n \* |\/\*\* )/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('Android premium widgets: premium off (default, today)', () => {
  it('adds no premium Kotlin, resources, receivers or TOKEN_READER', () => {
    const files = plugin.androidFiles(free());
    expect(files[KT]).toBeUndefined();
    expect(files[COPY_KT]).toBeUndefined();
    expect(files['res/layout/bonded_widget_little_things.xml']).toBeUndefined();
    expect(files['res/xml/bonded_widget_little_things_info.xml']).toBeUndefined();
    for (const content of Object.values(files)) expect(content).not.toContain('WidgetTokenStore');

    const m = plugin.addWidgetReceivers(manifest(), free());
    expect((app(m).receiver ?? []).map((r) => r.$['android:name'])).toEqual([
      `${PKG}.widget.BondedTodayWidget`,
      `${PKG}.widget.BondedYourTurnWidget`,
    ]);
    expect(app(m)['meta-data']).toBeUndefined();
  });

  it('removes premium entries left from an earlier premium prebuild', () => {
    const m = plugin.addWidgetReceivers(plugin.addWidgetReceivers(manifest(), premium()), free());
    expect(receiver(m, 'BondedLittleThingsWidget')).toBeUndefined();
    expect(receiver(m, 'BondedLittleThingsActionReceiver')).toBeUndefined();
    expect(app(m)['meta-data']).toBeUndefined();
  });
});

describe('Android premium widgets: manifest (SEC-21 MOB-78 check 2)', () => {
  it('adds the Little things provider: private, picker info, update + app REFRESH only', () => {
    const m = plugin.addWidgetReceivers(manifest(), premium());
    const provider = receiver(m, 'BondedLittleThingsWidget')!;
    expect(provider.$).toEqual({
      'android:name': `${PKG}.widget.BondedLittleThingsWidget`,
      'android:exported': 'false',
      'android:label': '@string/bonded_widget_little_things_label',
    });
    expect(provider['intent-filter']![0]!.action.map((a) => a.$['android:name'])).toEqual([
      'android.appwidget.action.APPWIDGET_UPDATE',
      plugin.REFRESH_ACTION,
    ]);
    expect(provider['meta-data']).toEqual([
      {
        $: {
          'android:name': 'android.appwidget.provider',
          'android:resource': '@xml/bonded_widget_little_things_info',
        },
      },
    ]);
  });

  it('adds the action receiver exported="false" with no intent-filter', () => {
    const m = plugin.addWidgetReceivers(manifest(), premium());
    const actions = receiver(m, 'BondedLittleThingsActionReceiver')!;
    expect(actions.$).toEqual({
      'android:name': `${PKG}.widget.BondedLittleThingsActionReceiver`,
      'android:exported': 'false',
    });
    expect(actions['intent-filter']).toBeUndefined();
  });

  it('sets TOKEN_READER (the module reads it as hasTokenReader) and stays idempotent', () => {
    const once = plugin.addWidgetReceivers(manifest(), premium());
    const twice = plugin.addWidgetReceivers(
      plugin.addWidgetReceivers(manifest(), premium()),
      premium(),
    );
    expect(twice).toEqual(once);
    expect(app(once)['meta-data']).toEqual([
      { $: { 'android:name': plugin.ANDROID_TOKEN_READER_META, 'android:value': 'true' } },
    ]);
    expect(plugin.ANDROID_TOKEN_READER_META).toBe('com.hellobonded.widgets.TOKEN_READER');
    expect(
      read(
        'plugins/widgets/modules/bonded-widgets/android/src/main/java/com/hellobonded/widgets/BondedWidgetsModule.kt',
      ),
    ).toContain(`TOKEN_READER_META = "${plugin.ANDROID_TOKEN_READER_META}"`);
  });

  it('every receiver of the widgets plugin is private', () => {
    const m = plugin.addWidgetReceivers(manifest(), premium());
    expect(app(m).receiver!.length).toBe(4);
    for (const r of app(m).receiver!) expect(r.$['android:exported']).toBe('false');
  });
});

describe('Android premium widgets: generated files', () => {
  const files = plugin.androidFiles(premium());
  const kt = files[KT]!;

  it('fills the package and the Supabase origin, no placeholders left', () => {
    expect(kt).toMatch(new RegExp(`^package ${PKG.replaceAll('.', '\\.')}\\.widget\\n`));
    expect(kt).toContain(`import ${PKG}.R`);
    expect(kt).toContain(`const val ENDPOINT = "${URL}/functions/v1/widget"`);
    expect(kt).not.toMatch(/__[A-Z_]+__/);
    expect(files[COPY_KT]).toMatch(
      new RegExp(`^// Generated.*\\npackage ${PKG.replaceAll('.', '\\.')}\\.widget\\n`),
    );
  });

  it('ships the layout, the picker info (resizable, home screen) and the strings', () => {
    const info = files['res/xml/bonded_widget_little_things_info.xml']!;
    expect(info).toContain('android:resizeMode="horizontal|vertical"');
    expect(info).toContain('android:widgetCategory="home_screen"');
    expect(info).toContain('android:initialLayout="@layout/bonded_widget_little_things"');
    expect(files['res/layout/bonded_widget_little_things.xml']).toBeDefined();
    expect(files['res/values/bonded_widget_premium_strings.xml']).toContain(
      '<string name="bonded_widget_little_things_label">Little things</string>',
    );
  });

  it('every R.* the Kotlin uses exists in the generated resources', () => {
    const ids = new Set<string>();
    for (const content of Object.values(files))
      for (const m of content.matchAll(/@\+id\/([a-z_]+)/g)) ids.add(m[1]!);
    for (const m of kt.matchAll(/R\.id\.([a-z_]+)/g)) expect(ids).toContain(m[1]);
    for (const m of kt.matchAll(/R\.layout\.([a-z_]+)/g))
      expect(files[`res/layout/${m[1]}.xml`]).toBeDefined();
    const layout = files['res/layout/bonded_widget_little_things.xml']!;
    for (const m of layout.matchAll(/@(drawable|color|string|style)\/([A-Za-z_]+)/g)) {
      const [, type, name] = m;
      const found = Object.entries(files).some(([file, content]) =>
        type === 'drawable'
          ? file === `res/drawable/${name}.xml`
          : type === 'color'
            ? file === `res/color/${name}.xml` || content.includes(`<color name="${name}">`)
            : type === 'style'
              ? content.includes(`<style name="${name}">`)
              : content.includes(`<string name="${name}">`),
      );
      expect([type, name, found]).toEqual([type, name, true]);
    }
  });

  it('generates the Kotlin copy table from en.json (escapes $ and quotes)', () => {
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const copy = plugin.kotlinPremiumCopy(en, PKG);
    expect(copy).toContain('"littleThings.tapToSend" to "Tap to send",');
    expect(copy).toContain('"littleThings.send.hug" to "Send {{partner}} a hug",');
    expect(plugin.kotlinPremiumCopy({ widgets: { a: 'say "hi" $x \\' } }, PKG)).toContain(
      '"a" to "say \\"hi\\" \\$x \\\\",',
    );
    expect(() => plugin.kotlinPremiumCopy({}, PKG)).toThrow('widgets');
    // A raw string: "\{" is not a valid Kotlin escape (caught by kotlinc once).
    expect(copy).toContain('Regex("""\\{\\{[^}]*\\}\\}""")');
  });

  it('every BondedPremiumCopy key the Kotlin uses exists in en.json', () => {
    const en = JSON.parse(read('src/i18n/locales/en.json')) as { widgets: Record<string, unknown> };
    const keys = [...kt.matchAll(/BondedPremiumCopy\.t\("([^"]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en.widgets);
      expect([key, typeof value]).toEqual([key, 'string']);
    }
  });
});

describe('Android premium widgets: token reader (SEC-21 MOB-78 check 1)', () => {
  const src = read(SOURCE);
  const store = block(src, 'object WidgetTokenStore {');
  const secureStore = read(`${SECURE_STORE}/SecureStoreModule.kt`);
  const aes = read(`${SECURE_STORE}/encryptors/AESEncryptor.kt`);

  it('reads the item the app writes (tokens.ts service and key)', () => {
    expect(store).toContain(`const val SERVICE = "${WIDGET_TOKEN_SERVICE}"`);
    expect(store).toContain(`const val KEY = "${WIDGET_TOKEN_KEY}"`);
    expect(store).toContain('const val PREF_KEY = "$SERVICE-$KEY"');
  });

  it('matches expo-secure-store’s Android layout (prefs, key, alias, JSON fields)', () => {
    expect(secureStore).toContain('private const val SHARED_PREFERENCES_NAME = "SecureStore"');
    expect(store).toContain('const val PREFS = "SecureStore"');
    expect(secureStore).toContain('return "$keychainService-$key"');
    // Alias: "$AES_CIPHER:$keychainService" + ":keystoreUnauthenticated".
    expect(aes).toContain('return "$AES_CIPHER:$baseAlias"');
    expect(aes).toContain('return "${getKeyStoreAlias(options)}:$suffix"');
    expect(aes).toContain('const val AES_CIPHER = "AES/GCM/NoPadding"');
    expect(secureStore).toContain('UNAUTHENTICATED_KEYSTORE_SUFFIX = "keystoreUnauthenticated"');
    expect(store).toContain(
      'const val KEY_ALIAS = "AES/GCM/NoPadding:$SERVICE:keystoreUnauthenticated"',
    );
    for (const field of ['"ct"', '"iv"', '"tlen"']) expect(aes).toContain(field);
    expect(secureStore).toContain('SCHEME_PROPERTY = "scheme"');
    expect(secureStore).toContain('KEYSTORE_ALIAS_PROPERTY = "keystoreAlias"');
    expect(secureStore).toContain('USES_KEYSTORE_SUFFIX_PROPERTY = "usesKeystoreSuffix"');
    expect(aes).toContain('const val NAME = "aes"');
    for (const field of ['"ct"', '"iv"', '"tlen"', '"scheme"', '"keystoreAlias"'])
      expect(store).toContain(field);
    expect(store).toContain('Cipher.getInstance("AES/GCM/NoPadding")');
    expect(store).toContain('KeyStore.getInstance("AndroidKeyStore")');
    expect(store).toContain('GCMParameterSpec(tagBits, iv)');
  });

  it('only reads: never writes, deletes or creates keys, and checks the token shape', () => {
    expect(store).not.toMatch(
      /\.edit\(|putString|\.remove\(|deleteEntry|KeyGenerator|ENCRYPT_MODE/,
    );
    expect(store).toContain('Regex("^bwt_[A-Za-z0-9_-]{43}$")');
    expect(store).toContain('Context.MODE_PRIVATE');
  });
});

describe('Android premium widgets: taps and network (SEC-21 MOB-78 checks 2 and 3)', () => {
  const src = read(SOURCE);
  const receiverSrc = block(src, 'class BondedLittleThingsActionReceiver : BroadcastReceiver() {');

  it('every PendingIntent is immutable; broadcasts are explicit to our own receiver', () => {
    const calls = [...src.matchAll(/PendingIntent\.get(Broadcast|Activity)\(([\s\S]*?)\n\s*\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const [, , args] of calls) expect(args).toContain('PendingIntent.FLAG_IMMUTABLE');
    expect(src).not.toContain('FLAG_MUTABLE');
    const broadcasts = calls.filter(([, kind]) => kind === 'Broadcast');
    expect(broadcasts.length).toBe(2);
    expect(
      src.match(/Intent\(context, BondedLittleThingsActionReceiver::class\.java\)/g),
    ).toHaveLength(2);
    // Activities only open our own package (deep links).
    expect(src).toContain('.setPackage(context.packageName)');
  });

  it('one distinct requestCode per kind, apart from the other PendingIntents', () => {
    const fn = block(src, 'fun sendRequestCode(kind: String): Int = when (kind) {');
    const codes = [...fn.matchAll(/(\d_\d{3})/g)].map((m) => m[1]);
    expect(codes).toHaveLength(SENDABLE.length);
    const others = [...src.matchAll(/REQUEST_[A-Z]+ = (\d_\d{3})/g)].map((m) => m[1]);
    expect(new Set([...codes, ...others]).size).toBe(codes.length + others.length);
    for (const kind of SENDABLE.slice(0, -1)) expect(fn).toContain(`"${kind}" ->`);
  });

  it('allow-lists the kind in the receiver and on the client (same set as iOS)', () => {
    expect(src).toContain(
      'val SENDABLE = setOf("hug", "kiss", "goodnight", "good_morning", "miss_you")',
    );
    expect(read('plugins/widgets/ios/premium/WidgetClient.swift')).toContain(
      'static let sendableKinds: Set<String> = ["hug", "kiss", "goodnight", "good_morning", "miss_you"]',
    );
    expect(receiverSrc).toMatch(
      /ACTION_SEND -> \{\s*val kind = intent\.getStringExtra\(EXTRA_KIND\) \?: return\s*if \(kind !in WidgetClient\.SENDABLE\) return/,
    );
    expect(block(src, 'object WidgetClient {')).toContain(
      'if (kind !in SENDABLE) return WidgetResponse.Failed(false)',
    );
  });

  it('network work runs in goAsync() on a background executor, never on the main thread', () => {
    const runAsync = block(src, '  fun runAsync(receiver: BroadcastReceiver, work: () -> Unit) {');
    expect(runAsync).toContain('receiver.goAsync()');
    expect(runAsync).toContain('executor.execute {');
    expect(runAsync).toContain('pending.finish()');
    expect(receiverSrc).toMatch(/runAsync\(this\) \{ send\(context, kind\) \}/);
    expect(receiverSrc).toMatch(/runAsync\(this\) \{ undo\(context\) \}/);
    const provider = block(src, 'class BondedLittleThingsWidget : AppWidgetProvider() {');
    expect(provider).toMatch(/runAsync\(this\) \{ LittleThingsWidgets\.refresh\(context\) \}/);
    // Callers of the network outside runAsync bodies: only refresh/send/undo, which run inside it.
    expect(provider).not.toMatch(/WidgetClient\./);
  });

  it('a new client id per tap; one retry reuses it, inside the time budget', () => {
    expect(receiverSrc).toContain('val clientId = UUID.randomUUID()');
    expect(receiverSrc.match(/WidgetClient\.send\(context, kind, clientId\)/g)).toHaveLength(2);
    expect(receiverSrc).toContain('response.retryable');
    expect(receiverSrc).toContain('RETRY_BEFORE_MS');
  });

  it('undo only for the id this widget just sent, inside the 5 s window', () => {
    expect(src).toContain('const val UNDO_WINDOW_MS = 5_000L');
    expect(receiverSrc).toMatch(
      /if \(id != null && cache\.undoable\(System\.currentTimeMillis\(\)\)\)/,
    );
    // The Undo PendingIntent carries no id: the receiver uses the stored one.
    expect(src).toContain(
      'action(context, BondedLittleThingsActionReceiver.ACTION_UNDO, null, REQUEST_UNDO)',
    );
  });

  it('client: Bearer header only, POST, no cache, no redirects, no logging', () => {
    const client = block(src, 'object WidgetClient {');
    expect(client).toContain('setRequestProperty("Authorization", "Bearer ${token.token}")');
    expect(client).toContain('useCaches = false');
    expect(client).toContain('instanceFollowRedirects = false');
    expect(client).toContain('requestMethod = "POST"');
    expect(client).not.toMatch(/\?token|token=|access_token/);
    expect(code(src)).not.toMatch(/android\.util\.Log|\bLog\.[dewiv]\(|println|printStackTrace/);
    // 401 → expired ("Open Bonded"), 403 → locked preview, 409 → limit / undo expired.
    expect(client).toMatch(/401 -> WidgetResponse\.Expired/);
    expect(client).toMatch(/403 -> WidgetResponse\.Locked/);
    expect(client).toContain('"UNDO_EXPIRED" -> WidgetResponse.UndoExpired');
    expect(client).toContain('"LITTLE_THING_LIMIT" ->');
  });
});

describe('Android premium widgets: what is stored and shown (SEC-21 MOB-78 check 4)', () => {
  const src = read(SOURCE);

  it('the widget cache holds allow-listed keys only, never the token or any text', () => {
    const cache = block(src, 'class LittleThingsCache(');
    const save = block(cache, '    fun save(context: Context, value: LittleThingsCache) {');
    const keys = [...save.matchAll(/\.put\("([a-zA-Z]+)"/g)].map((m) => m[1]).sort();
    expect(keys).toEqual([
      'atLimit',
      'partner',
      'premium',
      'sentId',
      'status',
      'statusAt',
      'statusKind',
    ]);
    expect(cache).toContain('const val PREFS = "bonded_widget_little_things"');
    expect(cache).not.toMatch(/token|bwt_/i);
  });

  it('never reads answer, message, voice or question text from the response', () => {
    expect(code(src)).not.toMatch(/question_text|answer|message_text|"body"|voice|signed_url/);
  });

  it('the analytics queue sends widget kind and action only (catalogue values)', () => {
    const queue = block(src, 'object WidgetActionQueue {');
    expect(queue).toContain('private const val PREFS = "bonded_widgets"');
    expect(queue).toContain('private const val KEY = "actions"');
    expect(queue).toContain('JSONObject().put("widget_kind", kind).put("action", action)');
    for (const kind of WIDGET_KINDS) expect(queue).toContain(`"${kind}"`);
    for (const action of WIDGET_ACTIONS) expect(queue).toContain(`"${action}"`);
    expect(queue).not.toMatch(/token|partner/i);
  });

  it('free or lapsed: the locked preview opens the paywall from=widget&widget_kind=little_things', () => {
    expect(src).toContain(
      'private const val PAYWALL_URL = "bonded://paywall?from=widget&widget_kind=little_things"',
    );
    expect(src).toMatch(
      /is LittleThingsView\.Locked -> \{[\s\S]*?setOnClickPendingIntent\(R\.id\.bonded_root, open\(context, PAYWALL_URL, REQUEST_PAYWALL\)\)/,
    );
    // `state` with premium:false is the locked preview, not data.
    expect(src).toMatch(
      /response is WidgetResponse\.Ok && !response\.body\.optBoolean\("premium", false\)[\s\S]*?return WidgetResponse\.Locked/,
    );
    // Locked and expired drop whatever the widget had cached.
    expect(src).toMatch(/is WidgetResponse\.Locked -> \{\s*LittleThingsCache\.clear\(context\)/);
    expect(src).toMatch(/is WidgetResponse\.Expired -> \{\s*LittleThingsCache\.clear\(context\)/);
  });

  it('sign-out (REFRESH with no token) drops to "Open Bonded" without a network call', () => {
    const provider = block(src, 'class BondedLittleThingsWidget : AppWidgetProvider() {');
    expect(provider).toMatch(
      /if \(WidgetTokenStore\.read\(context\) == null\) \{\s*LittleThingsCache\.clear\(context\)\s*LittleThingsWidgets\.redraw\(context, LittleThingsView\.Expired\)/,
    );
  });
});
