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
    // Today, Your turn, Little things + its action receiver, Days together.
    expect(app(m).receiver!.length).toBe(5);
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

  it('SEC Info 1: the Kotlin endpoint comes from the same https-only origin check as iOS', () => {
    expect(() =>
      plugin.options(base(), { premium: true, supabaseUrl: 'http://example.supabase.co' }),
    ).toThrow('https://');
    const local = plugin.androidFiles(
      plugin.options(base(), { premium: true, supabaseUrl: 'http://10.0.2.2:54321' }),
    )[KT]!;
    expect(local).toContain('const val ENDPOINT = "http://10.0.2.2:54321/functions/v1/widget"');
    // The Kotlin has no other origin: the endpoint is the only URL it posts to.
    expect(read(SOURCE)).toContain('const val ENDPOINT = "__SUPABASE_URL__/functions/v1/widget"');
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
    // MOB-78 emulator check: the picker preview showed a blank button. The default label is the
    // neutral lock-screen one (no partner name).
    expect(files['res/values/bonded_widget_premium_strings.xml']).toContain(
      '<string name="bonded_widget_little_things_preview_send">Send a hug</string>',
    );
    expect(files['res/layout/bonded_widget_little_things.xml']).toContain(
      'android:text="@string/bonded_widget_little_things_preview_send"',
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

  it('SEC Info 2: never draws the partner name on a keyguard host (no RemoteViews redaction)', () => {
    expect(src).toMatch(
      /fun onKeyguard\(options: Bundle\?\): Boolean =\s*options\?\.getInt\(AppWidgetManager\.OPTION_APPWIDGET_HOST_CATEGORY, -1\) ==\s*AppWidgetProviderInfo\.WIDGET_CATEGORY_KEYGUARD/,
    );
    const ready = block(src, '  private fun ready(');
    expect(ready).toContain('val hideName = onKeyguard(options)');
    expect(ready).toMatch(
      /"sent" ->\s*if \(hideName\) BondedPremiumCopy\.t\("lockSend\.sent"\)\s*else BondedPremiumCopy\.t\("littleThings\.sent"/,
    );
    expect(ready).toContain('sendLabel(kind, cache.partner, hideName)');
    expect(src).toMatch(
      /"hug" ->\s*if \(hideName\) BondedPremiumCopy\.t\("lockSend\.name"\)\s*else BondedPremiumCopy\.t\("littleThings\.send\.hug"/,
    );
    // Every use of the partner name goes through the hideName switch.
    const uses = [...code(src).matchAll(/"partner" to /g)].length;
    expect(uses).toBe(2);
  });

  it('sign-out (REFRESH with no token) drops to "Open Bonded" without a network call', () => {
    const provider = block(src, 'class BondedLittleThingsWidget : AppWidgetProvider() {');
    expect(provider).toMatch(
      /if \(WidgetTokenStore\.read\(context\) == null\) \{\s*LittleThingsCache\.clear\(context\)\s*LittleThingsWidgets\.redraw\(context, LittleThingsView\.Expired\)/,
    );
  });
});

describe('Android premium widgets: Days together (MOB-78e, 38c-3)', () => {
  const DAYS_KT = `${WIDGET_DIR}/BondedDaysTogether.kt`;
  const DAYS_SOURCE = 'plugins/widgets/android/premium/kotlin/BondedDaysTogether.kt';
  const src = read(DAYS_SOURCE);
  const body = code(src);
  const files = plugin.androidFiles(premium());

  it('only with premium: Kotlin, layout, picker info and strings', () => {
    const off = plugin.androidFiles(free());
    expect(off[DAYS_KT]).toBeUndefined();
    expect(off['res/layout/bonded_widget_days_together.xml']).toBeUndefined();
    expect(off['res/xml/bonded_widget_days_together_info.xml']).toBeUndefined();

    const kt = files[DAYS_KT]!;
    expect(kt).toMatch(new RegExp(`^package ${PKG.replaceAll('.', '\\.')}\\.widget\\n`));
    expect(kt).toContain(`import ${PKG}.R`);
    expect(kt).not.toMatch(/__[A-Z_]+__/);
    const info = files['res/xml/bonded_widget_days_together_info.xml']!;
    expect(info).toContain('android:widgetCategory="home_screen"');
    expect(info).toContain('android:initialLayout="@layout/bonded_widget_days_together"');
    expect(info).toContain('android:description="@string/bonded_widget_days_together_description"');
    const strings = files['res/values/bonded_widget_premium_strings.xml']!;
    expect(strings).toContain(
      '<string name="bonded_widget_days_together_label">Days together</string>',
    );
    expect(strings).toContain(
      '<string name="bonded_widget_days_together_description">Days together</string>',
    );
  });

  it('manifest: a private provider with update + REFRESH only, removed when premium is off', () => {
    const m = plugin.addWidgetReceivers(manifest(), premium());
    const provider = receiver(m, 'BondedDaysTogetherWidget')!;
    expect(provider.$).toEqual({
      'android:name': `${PKG}.widget.BondedDaysTogetherWidget`,
      'android:exported': 'false',
      'android:label': '@string/bonded_widget_days_together_label',
    });
    expect(provider['intent-filter']![0]!.action.map((a) => a.$['android:name'])).toEqual([
      'android.appwidget.action.APPWIDGET_UPDATE',
      plugin.REFRESH_ACTION,
    ]);
    expect(provider['meta-data']![0]!.$['android:resource']).toBe(
      '@xml/bonded_widget_days_together_info',
    );
    const back = plugin.addWidgetReceivers(m, free());
    expect(receiver(back, 'BondedDaysTogetherWidget')).toBeUndefined();
  });

  it('every R.* it uses exists, and the layout resources resolve', () => {
    const ids = new Set<string>();
    for (const m of files['res/layout/bonded_widget_days_together.xml']!.matchAll(
      /@\+id\/([a-z_]+)/g,
    ))
      ids.add(m[1]!);
    for (const m of src.matchAll(/R\.id\.([a-z_]+)/g)) expect(ids).toContain(m[1]);
    for (const m of src.matchAll(/R\.layout\.([a-z_]+)/g))
      expect(files[`res/layout/${m[1]}.xml`]).toBeDefined();
    const layout = files['res/layout/bonded_widget_days_together.xml']!;
    for (const m of layout.matchAll(/@(drawable|color|string)\/([A-Za-z_]+)/g)) {
      const [, type, name] = m;
      const found = Object.entries(files).some(([file, content]) =>
        type === 'drawable'
          ? file === `res/drawable/${name}.xml`
          : type === 'color'
            ? file === `res/color/${name}.xml` || content.includes(`<color name="${name}">`)
            : content.includes(`<string name="${name}">`),
      );
      expect([type, name, found]).toEqual([type, name, true]);
    }
  });

  it('every copy key it uses (plain and plural) exists in en.json', () => {
    const en = JSON.parse(read('src/i18n/locales/en.json')) as { widgets: Record<string, unknown> };
    const get = (key: string) =>
      key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en.widgets);
    const plain = [...body.matchAll(/BondedPremiumCopy\.t\("([^"]+)"/g)].map((m) => m[1]!);
    const plural = [...body.matchAll(/plural\("([^"]+)"/g)].map((m) => m[1]!);
    expect(plain).toEqual(
      expect.arrayContaining([
        'days.name',
        'days.addDates',
        'locked.premium',
        'locked.cta',
        'open',
      ]),
    );
    expect(plural).toEqual(
      expect.arrayContaining(['days.count', 'days.inBonded', 'days.anniversaryToday']),
    );
    for (const key of plain) expect([key, typeof get(key)]).toEqual([key, 'string']);
    for (const key of plural)
      for (const form of ['_one', '_other'])
        expect([key + form, typeof get(key + form)]).toEqual([key + form, 'string']);
    // The partner placeholder is filled with the exact i18next token of en.json.
    expect(get('days.next.birthdayPartner_other')).toContain('{{partner, capitalize}}');
    expect(body).toContain('mapOf("partner, capitalize" to name)');
  });

  it('read-only: only the `state` action, through the shared client; no own network or logging', () => {
    expect(body).toContain('WidgetClient.state(context)');
    expect(body).not.toMatch(/WidgetClient\.(send|undo)|HttpURLConnection|URL\(|openConnection/);
    expect(body).not.toMatch(/android\.util\.Log|Log\.[deiwv]\(|println|printStackTrace/);
    expect(body).not.toMatch(/getBroadcast|BondedLittleThingsActionReceiver/);
    // Token: read only, never written.
    expect(body).toContain('WidgetTokenStore.read(context)');
    expect(body).not.toMatch(/WidgetTokenStore\.(write|save|delete|clear)/);
  });

  it('allow-listed state fields only; never answer, message, voice or question text', () => {
    const fields = [
      ...body.matchAll(
        /(?:optString|optInt|optJSONArray|isNull|has)\("([a-z_]+)"|intOrNull\(\w+, "([a-z_]+)"/g,
      ),
    ]
      .map((m) => m[1] ?? m[2]!)
      .filter((f) => f !== 'kind' && f !== 'whose' && f !== 'days_until' && f !== 'years');
    expect(new Set(fields)).toEqual(
      new Set(['partner_first_name', 'days_together', 'days_in_bonded', 'next_key_dates']),
    );
    expect(body).not.toMatch(/question_text|answer|message|voice|today"|on_this_day|"token"/);
    // The cache keeps numbers, the key-date kind/whose and the partner's first name only.
    const keys = [...body.matchAll(/put(?:Int|String)\("([a-z_]+)"/g)].map((m) => m[1]!);
    expect(new Set(keys)).toEqual(
      new Set([
        'days_together',
        'days_in_bonded',
        'next_kind',
        'next_days_until',
        'next_years',
        'next_whose',
        'partner_first_name',
      ]),
    );
    // Its own prefs file, not the app's `bonded_widgets` (snapshot) or the token's secure store.
    expect(src).toContain('const val PREFS = "bonded_widget_days_together"');
  });

  it('free/lapsed → locked preview to the paywall from=widget; 401 → "Open Bonded"; both clear the cache', () => {
    expect(src).toContain(
      'const val DAYS_PAYWALL_URL = "bonded://paywall?from=widget&widget_kind=days_together"',
    );
    expect(body).toMatch(/is WidgetResponse\.Locked -> \{\s*DaysCache\.clear\(context, "locked"\)/);
    expect(body).toMatch(
      /is WidgetResponse\.Expired -> \{\s*DaysCache\.clear\(context, "expired"\)/,
    );
    const locked = body.slice(body.indexOf('is DaysView.Locked -> {'));
    expect(locked.slice(0, 600)).toContain('open(context, DAYS_PAYWALL_URL, REQUEST_PAYWALL)');
    expect(body).toContain('WidgetActionQueue.record(context, "days_together", "view_locked")');
    expect(WIDGET_KINDS).toContain('days_together');
    expect(WIDGET_ACTIONS).toContain('view_locked');
  });

  it('every PendingIntent is immutable, explicit to this package, with its own request codes', () => {
    const pending = [...body.matchAll(/PendingIntent\.get\w+\(/g)].length;
    const immutable = [...body.matchAll(/PendingIntent\.FLAG_IMMUTABLE/g)].length;
    expect(pending).toBe(1);
    expect(immutable).toBe(pending);
    expect(body).toContain('.setPackage(context.packageName)');
    const codes = [...body.matchAll(/const val REQUEST_\w+ = ([\d_]+)/g)].map((m) => m[1]!);
    const little = [...code(read(SOURCE)).matchAll(/const val REQUEST_\w+ = ([\d_]+)/g)].map(
      (m) => m[1]!,
    );
    expect(codes).toHaveLength(3);
    for (const c of codes) expect(little).not.toContain(c);
  });

  it('SEC Info 2: the partner name only when not on a keyguard host', () => {
    expect(body).toContain('val hideName = LittleThingsWidgets.onKeyguard(options)');
    expect(body).toMatch(/"partner" && !hideName && cache\.partnerFirstName != null/);
    expect([...body.matchAll(/partnerFirstName\b/g)].length).toBeGreaterThan(0);
    expect([...body.matchAll(/"partner, capitalize" to /g)].length).toBe(1);
  });

  it('sign-out (REFRESH with no token) drops to "Open Bonded" without a network call', () => {
    const provider = block(src, 'class BondedDaysTogetherWidget : AppWidgetProvider() {');
    expect(provider).toMatch(
      /if \(WidgetTokenStore\.read\(context\) == null\) \{\s*DaysCache\.clear\(context, "expired"\)\s*DaysTogetherWidgets\.redraw\(context, DaysView\.Expired\)/,
    );
    expect(provider).toContain(
      'LittleThingsWidgets.runAsync(this) { DaysTogetherWidgets.refresh(context) }',
    );
  });
});
