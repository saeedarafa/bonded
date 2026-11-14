/**
 * Bonded widgets config plugin (MOB-30, screen 38, D26; 38b pair MOB-57, D47).
 *
 * iOS: a WidgetKit app extension target (`BondedWidgetExtension`) with the Swift sources in
 * plugins/widgets/ios, the mascot stills from design-handoff/assets/mascot (SVG in an asset
 * catalog) and colours generated from src/ui/tokens.json. App and extension share an App Group;
 * the app writes the snapshot there through the local module plugins/widgets/modules/bonded-widgets.
 *
 * Android: two AppWidgetProvider receivers (RemoteViews; why not Glance: plugins/widgets/README.md)
 * with layouts, colours (light + night from tokens) and the mascot as VectorDrawables converted
 * from the same SVGs. The app writes shared preferences and broadcasts REFRESH.
 *
 * Reveal rule (FUN-04): the widgets only ever read the snapshot, which holds booleans, the deadline,
 * counts and the partner's first name (src/features/widgets/snapshot.ts).
 *
 * Premium widgets (MOB-77, D59, SEC-21 option A), behind the `premium` prop (off until a device
 * build check, see plugins/widgets/README.md): a shared keychain access group for the widget token
 * on the app and the extension (the app keeps its own group first, so its other keychain items stay
 * private), Info.plist `BondedWidgetKeychainGroup` (read by the bridge module as
 * `keychainAccessGroup`; without it the app never mints), the Supabase URL for the extension and the
 * Swift sources in plugins/widgets/ios/premium. The token is never written to the App Group.
 */
const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const { svgToVector } = require('./svgToVector');

const IOS_TARGET = 'BondedWidgetExtension';
const IOS_SWIFT = ['BondedSnapshot.swift', 'BondedWidgets.swift', 'BondedColors.swift'];
const IOS_ASSETS = 'BondedWidgetAssets.xcassets';
const IOS_PLIST = `${IOS_TARGET}-Info.plist`;
const IOS_ENTITLEMENTS = `${IOS_TARGET}.entitlements`;
const APP_GROUPS_KEY = 'com.apple.security.application-groups';
const INFO_PLIST_GROUP_KEY = 'BondedAppGroup';
const KEYCHAIN_GROUPS_KEY = 'keychain-access-groups';
const INFO_PLIST_KEYCHAIN_KEY = 'BondedWidgetKeychainGroup';
const INFO_PLIST_SUPABASE_KEY = 'BondedSupabaseURL';
const TEAM_PREFIX = '$(AppIdentifierPrefix)';
/** Premium widget sources (plugins/widgets/ios/premium), compiled only with `premium: true`. */
const IOS_PREMIUM_SWIFT = [
  'WidgetTokenStore.swift',
  'WidgetClient.swift',
  'WidgetActionQueue.swift',
  'BondedPremiumCopy.swift',
  'BondedCopyFormat.swift',
  'LittleThingsIntents.swift',
  'LittleThingsWidget.swift',
  'LockScreenWidgets.swift',
  'LockScreenSend.swift',
];
/** Where BondedWidgets.swift's bundle lists the premium widgets (replaced at prebuild). */
const PREMIUM_BUNDLE_MARKER = '    // BONDED_PREMIUM_WIDGETS';
const PREMIUM_BUNDLE_WIDGETS = [
  '    if #available(iOSApplicationExtension 17.0, *) {',
  '      BondedLittleThingsWidget()',
  '      BondedLockQuestionWidget()',
  '      BondedLockThinkingWidget()',
  '      BondedLockSendWidget()',
  '    }',
  '    if #available(iOSApplicationExtension 18.0, *) {',
  '      BondedSendHugControl()',
  '    }',
].join('\n');
const DEFAULT_DEPLOYMENT_TARGET = '16.4';

const MOODS = ['snuggled', 'saving-a-seat', 'waiting', 'celebrating', 'napping', 'together'];
const REFRESH_ACTION = 'com.hellobonded.widgets.REFRESH';
const ANDROID_RECEIVERS = [
  {
    name: 'BondedTodayWidget',
    label: 'bonded_widget_today_label',
    info: 'bonded_widget_today_info',
  },
  {
    name: 'BondedYourTurnWidget',
    label: 'bonded_widget_your_turn_label',
    info: 'bonded_widget_your_turn_info',
  },
];

/** Token colours the widgets use (src/ui/tokens.json `color.light` / `color.dark`). */
const WIDGET_COLORS = ['surface', 'line', 'text', 'text2', 'text3', 'you', 'youText', 'onYou'];

/** Premium Android widgets (MOB-78), only with `premium: true`. */
const ANDROID_PREMIUM_RECEIVERS = [
  {
    name: 'BondedLittleThingsWidget',
    label: 'bonded_widget_little_things_label',
    info: 'bonded_widget_little_things_info',
  },
];
/** The taps of the premium widgets: exported="false", no intent-filter (SEC-21 MOB-78 check 2). */
const ANDROID_ACTION_RECEIVER = 'BondedLittleThingsActionReceiver';
/** Application meta-data the bridge module reads as `hasTokenReader` (SEC L1). */
const ANDROID_TOKEN_READER_META = 'com.hellobonded.widgets.TOKEN_READER';

// This folder (no `__dirname`: the lint config has no Node globals for .js files).
const HERE = path.dirname(require.resolve('./svgToVector'));

/** Hosts that may use plain http for local Supabase (simulator, emulator). Everything else: https. */
const LOCAL_HTTP_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2'];

/**
 * SEC Info 1: the widget sends the bearer token to this origin, so it must be https; plain http is
 * allowed only for a local Supabase (`localhost`, `127.0.0.1`, the Android emulator's `10.0.2.2`).
 */
function isWidgetOrigin(url) {
  const m = /^(https?):\/\/([^/\s:?#@]+)(:\d{1,5})?$/.exec(url);
  if (!m) return false;
  return m[1] === 'https' || LOCAL_HTTP_HOSTS.includes(m[2].toLowerCase());
}

function options(config, props = {}) {
  const bundleId = config.ios?.bundleIdentifier;
  const androidPackage = config.android?.package;
  if (!bundleId || !androidPackage)
    throw new Error('plugins/widgets: ios.bundleIdentifier and android.package are required');
  const premium = props.premium === true;
  const supabaseUrl = (props.supabaseUrl ?? '').replace(/\/+$/, '');
  if (premium && !isWidgetOrigin(supabaseUrl))
    throw new Error(
      'plugins/widgets: premium widgets need supabaseUrl (https://<host>, no path; http only for localhost, 127.0.0.1 or 10.0.2.2)',
    );
  return {
    bundleId,
    androidPackage,
    premium,
    supabaseUrl: premium ? supabaseUrl : '',
    /** Without the team prefix; the entitlement and Info.plist get `$(AppIdentifierPrefix)` + this. */
    keychainGroup: props.keychainGroup ?? `${bundleId}.widget`,
    appGroup: props.appGroup ?? `group.${bundleId}`,
    extensionBundleId: `${bundleId}.widgets`,
    enPath: props.enPath ?? path.join(HERE, '..', '..', 'src', 'i18n', 'locales', 'en.json'),
    tokensPath: props.tokensPath ?? path.join(HERE, '..', '..', 'src', 'ui', 'tokens.json'),
    mascotDir: props.mascotDir ?? path.join(HERE, '..', '..', 'design-handoff', 'assets', 'mascot'),
    version: config.version ?? '1.0.0',
    buildNumber: config.ios?.buildNumber ?? '1',
  };
}

/** The full keychain access group (team prefix resolved by Xcode at build time). */
const keychainGroup = (o) => `${TEAM_PREFIX}${o.keychainGroup}`;

/**
 * The app's `keychain-access-groups`: its own group first (the default for items written without a
 * group, like the Supabase session, so they stay out of the shared group), then the widget group.
 * Keeps any group already there.
 */
function appKeychainGroups(existing, o) {
  const own = `${TEAM_PREFIX}${o.bundleId}`;
  const rest = (existing ?? []).filter((g) => g !== own && g !== keychainGroup(o));
  return [own, ...rest, keychainGroup(o)];
}

// ---------- shared generators (pure; tested in src/features/widgets/__tests__/plugin.test.ts) ----

const camel = (key) => key.charAt(0).toUpperCase() + key.slice(1);
const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/** Swift colours that follow light and dark (tokens only, DESIGN.md §2). */
function swiftColors(tokens) {
  const lines = WIDGET_COLORS.map((key) => {
    const [lr, lg, lb] = rgb(tokens.color.light[key]);
    const [dr, dg, db] = rgb(tokens.color.dark[key]);
    const c = (r, g, b) =>
      `UIColor(red: ${r.toFixed(4)}, green: ${g.toFixed(4)}, blue: ${b.toFixed(4)}, alpha: 1)`;
    return (
      `  static let bonded${camel(key)} = Color(UIColor { traits in\n` +
      `    traits.userInterfaceStyle == .dark\n      ? ${c(dr, dg, db)}\n      : ${c(lr, lg, lb)}\n  })`
    );
  });
  return (
    '// Generated by plugins/widgets from src/ui/tokens.json at prebuild. Do not edit.\n' +
    'import SwiftUI\nimport UIKit\n\nextension Color {\n' +
    lines.join('\n') +
    '\n}\n'
  );
}

/** Android colour resources (values / values-night). */
function androidColors(tokens, scheme) {
  const items = WIDGET_COLORS.map(
    (key) => `    <color name="bonded_widget_${snake(key)}">${tokens.color[scheme][key]}</color>`,
  );
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<!-- Generated by plugins/widgets from src/ui/tokens.json at prebuild. Do not edit. -->\n' +
    `<resources>\n${items.join('\n')}\n</resources>\n`
  );
}

/** A Swift string literal (the copy has no control characters but newlines). */
function swiftString(value) {
  if (/[\u0000-\u0009\u000b-\u001f]/.test(value))
    throw new Error(`plugins/widgets: control character in copy ${JSON.stringify(value)}`);
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * The `widgets.*` copy of en.json (spec §7) as a Swift table for the premium widgets, flattened to
 * dotted keys (`littleThings.send.hug`). i18next placeholders stay as they are; the extension fills
 * them (BondedCopy.t). Fixed copy only: nothing from the server.
 */
function swiftPremiumCopy(en) {
  const rows = flattenWidgetsCopy(en).map(
    ([name, value]) => `    ${swiftString(name)}: ${swiftString(value)},`,
  );
  return (
    '// Generated by plugins/widgets from src/i18n/locales/en.json `widgets.*` at prebuild. Do not edit.\n' +
    'import Foundation\n\n' +
    'enum BondedCopy {\n' +
    '  static let strings: [String: String] = [\n' +
    rows.join('\n') +
    '\n  ]\n}\n'
  );
}

/** A Kotlin string literal (`$` would start a template). */
function kotlinString(value) {
  if (/[\u0000-\u0009\u000b-\u001f]/.test(value))
    throw new Error(`plugins/widgets: control character in copy ${JSON.stringify(value)}`);
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')}"`;
}

/** The `widgets.*` copy as dotted keys (shared by the Swift and Kotlin tables). */
function flattenWidgetsCopy(en) {
  if (!en.widgets) throw new Error('plugins/widgets: en.json has no widgets.* copy');
  const rows = [];
  const walk = (node, prefix) => {
    for (const key of Object.keys(node).sort()) {
      const value = node[key];
      const name = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') rows.push([name, value]);
      else if (value && typeof value === 'object') walk(value, name);
    }
  };
  walk(en.widgets, '');
  return rows;
}

/**
 * The same `widgets.*` table for the Android premium widgets (MOB-78). `t()` fills `{{name}}`
 * placeholders and drops any it was not given. Fixed copy only: nothing from the server.
 */
function kotlinPremiumCopy(en, androidPackage) {
  const rows = flattenWidgetsCopy(en).map(
    ([name, value]) => `    ${kotlinString(name)} to ${kotlinString(value)},`,
  );
  return (
    '// Generated by plugins/widgets from src/i18n/locales/en.json `widgets.*` at prebuild. Do not edit.\n' +
    `package ${androidPackage}.widget\n\n` +
    'object BondedPremiumCopy {\n' +
    '  private val strings: Map<String, String> = mapOf(\n' +
    rows.join('\n') +
    '\n  )\n\n' +
    '  private val placeholder = Regex("""\\{\\{[^}]*\\}\\}""")\n\n' +
    '  fun t(key: String, args: Map<String, String> = emptyMap()): String {\n' +
    '    var value = strings[key] ?: return ""\n' +
    '    for ((name, arg) in args) value = value.replace("{{" + name + "}}", arg)\n' +
    '    return placeholder.replace(value, "")\n' +
    '  }\n}\n'
  );
}

/** Widget picker label, description and preview label for the premium widgets (from en.json). */
function androidPremiumStrings(en) {
  const lt = en.widgets?.littleThings ?? {};
  const xml = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"');
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<!-- Generated by plugins/widgets from src/i18n/locales/en.json `widgets.*` at prebuild. Do not edit. -->\n' +
    '<resources>\n' +
    `    <string name="bonded_widget_little_things_label">${xml(lt.name)}</string>\n` +
    `    <string name="bonded_widget_little_things_description">${xml(lt.tapToSend)}</string>\n` +
    // Default hug label for the picker preview and the first frame (no partner name; the widget
    // replaces it on every draw).
    `    <string name="bonded_widget_little_things_preview_send">${xml(en.widgets?.lockSend?.name)}</string>\n` +
    '</resources>\n'
  );
}

function iosInfoPlist(o) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>Bonded</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>${o.version}</string>
  <key>CFBundleVersion</key>
  <string>${o.buildNumber}</string>
  <key>${INFO_PLIST_GROUP_KEY}</key>
  <string>${o.appGroup}</string>${
    o.premium
      ? `
  <key>${INFO_PLIST_KEYCHAIN_KEY}</key>
  <string>${keychainGroup(o)}</string>
  <key>${INFO_PLIST_SUPABASE_KEY}</key>
  <string>${o.supabaseUrl}</string>`
      : ''
  }
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;
}

function iosEntitlements(o) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>${APP_GROUPS_KEY}</key>
  <array>
    <string>${o.appGroup}</string>
  </array>${
    o.premium
      ? `
  <key>${KEYCHAIN_GROUPS_KEY}</key>
  <array>
    <string>${keychainGroup(o)}</string>
  </array>`
      : ''
  }
</dict>
</plist>
`;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Every file of the iOS extension, keyed by its path inside ios/<target>/. */
function iosFiles(o) {
  const tokens = JSON.parse(fs.readFileSync(o.tokensPath, 'utf8'));
  const files = {
    [IOS_PLIST]: iosInfoPlist(o),
    [IOS_ENTITLEMENTS]: iosEntitlements(o),
    'BondedColors.swift': swiftColors(tokens),
    [`${IOS_ASSETS}/Contents.json`]: json({ info: { author: 'xcode', version: 1 } }),
  };
  for (const name of ['BondedSnapshot.swift', 'BondedWidgets.swift'])
    files[name] = fs.readFileSync(path.join(HERE, 'ios', name), 'utf8');
  files['BondedWidgets.swift'] = files['BondedWidgets.swift'].replace(
    PREMIUM_BUNDLE_MARKER,
    o.premium ? PREMIUM_BUNDLE_WIDGETS : '',
  );
  if (o.premium) {
    for (const name of IOS_PREMIUM_SWIFT.filter((n) => n !== 'BondedPremiumCopy.swift'))
      files[name] = fs.readFileSync(path.join(HERE, 'ios', 'premium', name), 'utf8');
    files['BondedPremiumCopy.swift'] = swiftPremiumCopy(
      JSON.parse(fs.readFileSync(o.enPath, 'utf8')),
    );
  }
  for (const mood of MOODS) {
    const set = `${IOS_ASSETS}/mascot-${mood}.imageset`;
    files[`${set}/mascot-${mood}.svg`] = fs.readFileSync(
      path.join(o.mascotDir, `${mood}.svg`),
      'utf8',
    );
    files[`${set}/Contents.json`] = json({
      images: [{ filename: `mascot-${mood}.svg`, idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
      properties: { 'preserves-vector-representation': true },
    });
  }
  return files;
}

/** Every Android file, keyed by its path inside android/app/src/main/. */
function androidFiles(o) {
  const tokens = JSON.parse(fs.readFileSync(o.tokensPath, 'utf8'));
  const files = {};
  const kotlin = fs
    .readFileSync(path.join(HERE, 'android', 'kotlin', 'BondedWidgets.kt'), 'utf8')
    .replaceAll('__PACKAGE__', o.androidPackage);
  files[`java/${o.androidPackage.replaceAll('.', '/')}/widget/BondedWidgets.kt`] = kotlin;
  const resDir = path.join(HERE, 'android', 'res');
  for (const dir of fs.readdirSync(resDir))
    for (const name of fs.readdirSync(path.join(resDir, dir)))
      files[`res/${dir}/${name}`] = fs.readFileSync(path.join(resDir, dir, name), 'utf8');
  if (o.premium) {
    const widgetDir = `java/${o.androidPackage.replaceAll('.', '/')}/widget`;
    files[`${widgetDir}/BondedLittleThings.kt`] = fs
      .readFileSync(
        path.join(HERE, 'android', 'premium', 'kotlin', 'BondedLittleThings.kt'),
        'utf8',
      )
      .replaceAll('__PACKAGE__', o.androidPackage)
      .replaceAll('__SUPABASE_URL__', o.supabaseUrl);
    const en = JSON.parse(fs.readFileSync(o.enPath, 'utf8'));
    files[`${widgetDir}/BondedPremiumCopy.kt`] = kotlinPremiumCopy(en, o.androidPackage);
    files['res/values/bonded_widget_premium_strings.xml'] = androidPremiumStrings(en);
    const premiumRes = path.join(HERE, 'android', 'premium', 'res');
    for (const dir of fs.readdirSync(premiumRes))
      for (const name of fs.readdirSync(path.join(premiumRes, dir)))
        files[`res/${dir}/${name}`] = fs.readFileSync(path.join(premiumRes, dir, name), 'utf8');
  }
  files['res/values/bonded_widget_colors.xml'] = androidColors(tokens, 'light');
  files['res/values-night/bonded_widget_colors.xml'] = androidColors(tokens, 'dark');
  for (const mood of MOODS) {
    const svg = fs.readFileSync(path.join(o.mascotDir, `${mood}.svg`), 'utf8');
    files[`res/drawable/bonded_widget_mascot_${mood.replaceAll('-', '_')}.xml`] = svgToVector(svg, {
      comment: `Generated by plugins/widgets from design-handoff/assets/mascot/${mood}.svg. Do not edit.`,
    });
  }
  return files;
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

// ---------- iOS ----------

const unquote = (s) => (typeof s === 'string' ? s.replace(/^"(.*)"$/, '$1') : s);

/** A native target by name (the xcode library quotes the names it writes). */
function findTarget(project, name) {
  const section = project.pbxNativeTargetSection();
  for (const key of Object.keys(section)) {
    const target = section[key];
    if (typeof target === 'object' && unquote(target.name) === name) return target;
  }
  return null;
}

/** The app target's build settings (Release first), for the team and deployment target. */
function appBuildSettings(project) {
  const app = project.getFirstTarget();
  const listId = app.firstTarget.buildConfigurationList;
  const list = project.pbxXCConfigurationList()[listId];
  const configs = project.pbxXCBuildConfigurationSection();
  const settings = (list?.buildConfigurations ?? []).map((c) => configs[c.value]?.buildSettings);
  return settings.filter(Boolean);
}

/**
 * The xcode library writes `undefined` for fields it doesn't know and a build file for every file
 * of a group. Drop both for our files: the plist and entitlements are not built, only referenced.
 */
function tidyFileReferences(project, group, productRef) {
  const refs = project.pbxFileReferenceSection();
  const buildFiles = project.pbxBuildFileSection();
  const ours = new Set([...group.pbxGroup.children.map((c) => c.value), productRef]);
  for (const id of ours) {
    const ref = refs[id];
    if (!ref) continue;
    for (const key of Object.keys(ref))
      if (ref[key] === undefined || ref[key] === 'undefined') delete ref[key];
    if (ref.lastKnownFileType === 'unknown') ref.lastKnownFileType = 'text.plist.entitlements';
  }
  const unbuilt = new Set(
    group.pbxGroup.children
      .filter((c) => c.comment === IOS_PLIST || c.comment === IOS_ENTITLEMENTS)
      .map((c) => c.value),
  );
  for (const key of Object.keys(buildFiles)) {
    const file = buildFiles[key];
    if (typeof file === 'object' && unbuilt.has(file.fileRef)) {
      delete buildFiles[key];
      delete buildFiles[`${key}_comment`];
    }
  }
}

/**
 * Adds the WidgetKit extension target to the Xcode project: files, phases, build settings, the
 * embed phase and the dependency on it from the app. Idempotent (a second prebuild changes nothing).
 */
function addWidgetTarget(project, o) {
  if (findTarget(project, IOS_TARGET)) return project;
  const objects = project.hash.project.objects;
  objects.PBXTargetDependency = objects.PBXTargetDependency || {};
  objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

  const appSettings = appBuildSettings(project);
  const deploymentTarget =
    unquote(appSettings.find((s) => s.IPHONEOS_DEPLOYMENT_TARGET)?.IPHONEOS_DEPLOYMENT_TARGET) ??
    DEFAULT_DEPLOYMENT_TARGET;
  const team = appSettings.find((s) => s.DEVELOPMENT_TEAM)?.DEVELOPMENT_TEAM;

  // Group first: it creates the file references and build files the phases reuse.
  const swift = o.premium ? [...IOS_SWIFT, ...IOS_PREMIUM_SWIFT] : IOS_SWIFT;
  const group = project.addPbxGroup(
    [...swift, IOS_ASSETS, IOS_PLIST, IOS_ENTITLEMENTS],
    IOS_TARGET,
    IOS_TARGET,
  );
  const mainGroup = project.getFirstProject().firstProject.mainGroup;
  project.addToPbxGroup(group.uuid, mainGroup);

  const target = project.addTarget(IOS_TARGET, 'app_extension', IOS_TARGET, o.extensionBundleId);
  project.addBuildPhase(swift, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  project.addBuildPhase([IOS_ASSETS], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
  // (addTarget already made the app depend on the extension.)
  tidyFileReferences(project, group, target.pbxNativeTarget.productReference);

  // The embed phase addTarget created: name it like Xcode does.
  const copyPhases = objects.PBXCopyFilesBuildPhase ?? {};
  for (const key of Object.keys(copyPhases)) {
    const phase = copyPhases[key];
    if (
      typeof phase === 'object' &&
      phase.dstSubfolderSpec === 13 &&
      phase.name === '"Copy Files"'
    ) {
      phase.name = '"Embed Foundation Extensions"';
      copyPhases[`${key}_comment`] = 'Embed Foundation Extensions';
    }
  }

  const listId = project.pbxNativeTargetSection()[target.uuid].buildConfigurationList;
  const list = project.pbxXCConfigurationList()[listId];
  const configs = project.pbxXCBuildConfigurationSection();
  for (const ref of list.buildConfigurations) {
    const settings = configs[ref.value].buildSettings;
    Object.assign(settings, {
      INFOPLIST_FILE: `"${IOS_TARGET}/${IOS_PLIST}"`,
      CODE_SIGN_ENTITLEMENTS: `"${IOS_TARGET}/${IOS_ENTITLEMENTS}"`,
      PRODUCT_BUNDLE_IDENTIFIER: `"${o.extensionBundleId}"`,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1"',
      IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
      MARKETING_VERSION: o.version,
      CURRENT_PROJECT_VERSION: o.buildNumber,
      GENERATE_INFOPLIST_FILE: 'NO',
      CLANG_ENABLE_MODULES: 'YES',
      SKIP_INSTALL: 'YES',
      ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: '""',
      LD_RUNPATH_SEARCH_PATHS:
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
      CODE_SIGN_STYLE: 'Automatic',
    });
    if (team) settings.DEVELOPMENT_TEAM = team;
  }
  return project;
}

function withIosWidgets(config, o) {
  config = withEntitlementsPlist(config, (c) => {
    const groups = new Set(c.modResults[APP_GROUPS_KEY] ?? []);
    groups.add(o.appGroup);
    c.modResults[APP_GROUPS_KEY] = [...groups];
    if (o.premium)
      c.modResults[KEYCHAIN_GROUPS_KEY] = appKeychainGroups(c.modResults[KEYCHAIN_GROUPS_KEY], o);
    return c;
  });
  config = withInfoPlist(config, (c) => {
    c.modResults[INFO_PLIST_GROUP_KEY] = o.appGroup;
    if (o.premium) c.modResults[INFO_PLIST_KEYCHAIN_KEY] = keychainGroup(o);
    else delete c.modResults[INFO_PLIST_KEYCHAIN_KEY];
    return c;
  });
  config = withDangerousMod(config, [
    'ios',
    (c) => {
      writeFiles(path.join(c.modRequest.platformProjectRoot, IOS_TARGET), iosFiles(o));
      return c;
    },
  ]);
  config = withXcodeProject(config, (c) => {
    addWidgetTarget(c.modResults, o);
    return c;
  });
  // EAS Build signs the extension too (provisioning profile with the App Group).
  const extra = config.extra ?? {};
  const eas = extra.eas ?? {};
  const build = eas.build ?? {};
  const experimental = build.experimental ?? {};
  const ios = experimental.ios ?? {};
  const appExtensions = (ios.appExtensions ?? []).filter((e) => e.targetName !== IOS_TARGET);
  appExtensions.push({
    targetName: IOS_TARGET,
    bundleIdentifier: o.extensionBundleId,
    entitlements: {
      [APP_GROUPS_KEY]: [o.appGroup],
      ...(o.premium ? { [KEYCHAIN_GROUPS_KEY]: [keychainGroup(o)] } : {}),
    },
  });
  config.extra = {
    ...extra,
    eas: {
      ...eas,
      build: { ...build, experimental: { ...experimental, ios: { ...ios, appExtensions } } },
    },
  };
  return config;
}

// ---------- Android ----------

/**
 * Adds the widget receivers to the application (idempotent). With `premium`: the Little things
 * provider, its action receiver (exported="false", no intent-filter) and the TOKEN_READER
 * meta-data; without it, removes all three.
 */
function addWidgetReceivers(manifest, o) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('plugins/widgets: AndroidManifest has no <application>');
  const providers = o.premium
    ? [...ANDROID_RECEIVERS, ...ANDROID_PREMIUM_RECEIVERS]
    : ANDROID_RECEIVERS;
  const fullName = (name) => `${o.androidPackage}.widget.${name}`;
  const ours = [...ANDROID_RECEIVERS, ...ANDROID_PREMIUM_RECEIVERS]
    .map((r) => fullName(r.name))
    .concat(fullName(ANDROID_ACTION_RECEIVER));
  const names = providers.map((r) => fullName(r.name));
  app.receiver = (app.receiver ?? []).filter((r) => !ours.includes(r.$['android:name']));
  app['meta-data'] = (app['meta-data'] ?? []).filter(
    (m) => m.$['android:name'] !== ANDROID_TOKEN_READER_META,
  );
  if (!app['meta-data'].length) delete app['meta-data'];
  if (o.premium) {
    app.receiver.push({
      $: { 'android:name': fullName(ANDROID_ACTION_RECEIVER), 'android:exported': 'false' },
    });
    app['meta-data'] = [
      ...(app['meta-data'] ?? []),
      { $: { 'android:name': ANDROID_TOKEN_READER_META, 'android:value': 'true' } },
    ];
  }
  providers.forEach((r, i) => {
    app.receiver.push({
      $: {
        'android:name': names[i],
        'android:exported': 'false',
        'android:label': `@string/${r.label}`,
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } },
            { $: { 'android:name': REFRESH_ACTION } },
          ],
        },
      ],
      'meta-data': [
        {
          $: { 'android:name': 'android.appwidget.provider', 'android:resource': `@xml/${r.info}` },
        },
      ],
    });
  });
  return manifest;
}

function withAndroidWidgets(config, o) {
  config = withAndroidManifest(config, (c) => {
    addWidgetReceivers(c.modResults, o);
    return c;
  });
  config = withDangerousMod(config, [
    'android',
    (c) => {
      writeFiles(
        path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main'),
        androidFiles(o),
      );
      return c;
    },
  ]);
  return config;
}

function withBondedWidgets(config, props = {}) {
  const o = options(config, props);
  config = withIosWidgets(config, o);
  config = withAndroidWidgets(config, o);
  return config;
}

module.exports = withBondedWidgets;
module.exports.withBondedWidgets = withBondedWidgets;
module.exports.addWidgetTarget = addWidgetTarget;
module.exports.findTarget = findTarget;
module.exports.addWidgetReceivers = addWidgetReceivers;
module.exports.iosFiles = iosFiles;
module.exports.androidFiles = androidFiles;
module.exports.options = options;
module.exports.appKeychainGroups = appKeychainGroups;
module.exports.swiftPremiumCopy = swiftPremiumCopy;
module.exports.kotlinPremiumCopy = kotlinPremiumCopy;
module.exports.ANDROID_TOKEN_READER_META = ANDROID_TOKEN_READER_META;
module.exports.IOS_PREMIUM_SWIFT = IOS_PREMIUM_SWIFT;
module.exports.IOS_TARGET = IOS_TARGET;
module.exports.REFRESH_ACTION = REFRESH_ACTION;
module.exports.isWidgetOrigin = isWidgetOrigin;
