import type { ExpoConfig } from 'expo/config';

/**
 * MOB-30: the widgets config plugin (plugins/widgets). What `expo prebuild` must produce:
 * the WidgetKit extension target embedded in the app, the App Group on both sides, the Android
 * receivers, and the generated art and colours. `npx expo prebuild --clean` was run by hand too
 * (see plugins/widgets/README.md); this keeps it from regressing.
 */

type Manifest = {
  manifest: {
    application?: {
      $: Record<string, string>;
      receiver?: {
        $: Record<string, string>;
        'intent-filter': { action: { $: Record<string, string> }[] }[];
        'meta-data': { $: Record<string, string> }[];
      }[];
    }[];
  };
};

type XcodeTarget = { buildConfigurationList: string; buildPhases: { comment: string }[] };

type XcodeProject = {
  parseSync(): XcodeProject;
  writeSync(): string;
  getFirstTarget(): {
    uuid: string;
    firstTarget: { dependencies: unknown[]; buildPhases: { value: string; comment: string }[] };
  };
  pbxXCConfigurationList(): Record<string, { buildConfigurations: { value: string }[] }>;
  pbxXCBuildConfigurationSection(): Record<string, { buildSettings: Record<string, string> }>;
  hash: { project: { objects: Record<string, Record<string, unknown>> } };
};

/* eslint-disable @typescript-eslint/no-require-imports */
// Jest runs in Node; the app tsconfig has no Node types, so type just what we use.
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
const plugin = require('../../../../plugins/widgets') as {
  (config: ExpoConfig): ExpoConfig;
  addWidgetTarget(project: XcodeProject, o: unknown): XcodeProject;
  findTarget(project: XcodeProject, name: string): XcodeTarget | null;
  addWidgetReceivers(manifest: Manifest, o: unknown): Manifest;
  iosFiles(o: unknown): Record<string, string>;
  androidFiles(o: unknown): Record<string, string>;
  options(config: ExpoConfig): Record<string, string>;
  IOS_TARGET: string;
  REFRESH_ACTION: string;
};
const xcode = require('xcode') as { project(file: string): XcodeProject };
const { svgToVector } = require('../../../../plugins/widgets/svgToVector') as {
  svgToVector(svg: string, o?: { sizeDp?: number }): string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Jest's working directory is the repo root.
const FIXTURE = 'src/features/widgets/__tests__/fixtures/template.pbxproj';
const GROUP = 'group.com.trybonded.app';

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

const opts = () => plugin.options(appConfig());

function project(): XcodeProject {
  // The template project prebuild makes without this plugin (Expo SDK 58). Parsed, never written.
  return xcode.project(FIXTURE).parseSync();
}

function targetSettings(p: XcodeProject, name: string) {
  const target = plugin.findTarget(p, name);
  if (!target) throw new Error(`no target ${name}`);
  const list = p.pbxXCConfigurationList()[target.buildConfigurationList]!;
  const configs = p.pbxXCBuildConfigurationSection();
  return list.buildConfigurations.map((c) => configs[c.value]!.buildSettings);
}

describe('widgets plugin: app config', () => {
  it('is registered and EAS signs the extension with the App Group', () => {
    const config = appConfig();
    expect(config.plugins).toContain('./plugins/widgets');
    const withWidgets = plugin({ ...config, plugins: [] });
    expect(withWidgets.extra?.eas?.build?.experimental?.ios?.appExtensions).toEqual([
      {
        targetName: 'BondedWidgetExtension',
        bundleIdentifier: 'com.trybonded.app.widgets',
        entitlements: { 'com.apple.security.application-groups': [GROUP] },
      },
    ]);
  });

  it('autolinks the bridge module from plugins/widgets/modules', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.expo.autolinking.nativeModulesDir).toBe('./plugins/widgets/modules');
    const moduleConfig = JSON.parse(
      fs.readFileSync('plugins/widgets/modules/bonded-widgets/expo-module.config.json', 'utf8'),
    );
    expect(moduleConfig.apple.modules).toEqual(['BondedWidgetsModule']);
    expect(moduleConfig.android.modules).toEqual(['com.trybonded.widgets.BondedWidgetsModule']);
  });
});

describe('widgets plugin: iOS', () => {
  it('adds the WidgetKit extension target, embedded in the app', () => {
    const p = plugin.addWidgetTarget(project(), opts());
    const target = plugin.findTarget(p, 'BondedWidgetExtension');
    expect(target).toBeTruthy();
    expect(target!.buildPhases.map((b) => b.comment).sort()).toEqual([
      'Frameworks',
      'Resources',
      'Sources',
    ]);
    for (const s of targetSettings(p, 'BondedWidgetExtension')) {
      expect(s).toMatchObject({
        PRODUCT_BUNDLE_IDENTIFIER: '"com.trybonded.app.widgets"',
        CODE_SIGN_ENTITLEMENTS: '"BondedWidgetExtension/BondedWidgetExtension.entitlements"',
        INFOPLIST_FILE: '"BondedWidgetExtension/BondedWidgetExtension-Info.plist"',
        TARGETED_DEVICE_FAMILY: '"1"',
      });
    }
    const app = p.getFirstTarget();
    expect(app.firstTarget.dependencies).toHaveLength(1);
    const text = p.writeSync();
    expect(text).toContain('Embed Foundation Extensions');
    expect(text).toContain('BondedWidgetExtension.appex in Copy Files');
    expect(text).toContain('com.apple.product-type.app-extension');
    for (const file of ['BondedWidgets.swift', 'BondedSnapshot.swift', 'BondedColors.swift'])
      expect(text).toContain(`${file} in Sources`);
    expect(text).toContain('BondedWidgetAssets.xcassets in Resources');
  });

  it('is idempotent (a second prebuild adds nothing)', () => {
    const once = plugin.addWidgetTarget(project(), opts()).writeSync();
    const p = project();
    plugin.addWidgetTarget(p, opts());
    plugin.addWidgetTarget(p, opts());
    expect(p.writeSync().split('BondedWidgetExtension').length).toBe(
      once.split('BondedWidgetExtension').length,
    );
  });

  it('writes the extension files: App Group, sources, mascot stills, token colours', () => {
    const files = plugin.iosFiles(opts());
    expect(files['BondedWidgetExtension.entitlements']).toContain(`<string>${GROUP}</string>`);
    const info = files['BondedWidgetExtension-Info.plist']!;
    expect(info).toContain('com.apple.widgetkit-extension');
    expect(info).toMatch(
      /<key>BondedAppGroup<\/key>\s*<string>group\.com\.trybonded\.app<\/string>/,
    );
    expect(files['BondedWidgets.swift']).toContain('bonded://today?widget=');
    expect(files['BondedColors.swift']).toContain('static let bondedSurface');
    for (const mood of ['waiting', 'celebrating', 'napping', 'saving-a-seat', 'snuggled']) {
      const set = `BondedWidgetAssets.xcassets/mascot-${mood}.imageset`;
      expect(files[`${set}/mascot-${mood}.svg`]).toContain('<svg');
      expect(JSON.parse(files[`${set}/Contents.json`]!).properties).toEqual({
        'preserves-vector-representation': true,
      });
    }
  });
});

describe('widgets plugin: Android', () => {
  const manifest = (): Manifest => ({ manifest: { application: [{ $: {} }] } });

  it('adds both widget receivers (update + REFRESH, provider info), once', () => {
    const m = plugin.addWidgetReceivers(plugin.addWidgetReceivers(manifest(), opts()), opts());
    const receivers = m.manifest.application![0]!.receiver!;
    expect(receivers.map((r) => r.$['android:name'])).toEqual([
      'com.trybonded.app.widget.BondedTodayWidget',
      'com.trybonded.app.widget.BondedYourTurnWidget',
    ]);
    for (const r of receivers) {
      expect(r.$['android:exported']).toBe('false');
      expect(r['intent-filter'][0]!.action.map((a) => a.$['android:name'])).toEqual([
        'android.appwidget.action.APPWIDGET_UPDATE',
        plugin.REFRESH_ACTION,
      ]);
      expect(r['meta-data'][0]!.$['android:name']).toBe('android.appwidget.provider');
    }
  });

  it('writes the providers, layouts, info, night colours and mascot vectors', () => {
    const files = plugin.androidFiles(opts());
    const kotlin = files['java/com/trybonded/app/widget/BondedWidgets.kt']!;
    expect(kotlin).toContain('package com.trybonded.app.widget');
    expect(kotlin).not.toContain('__PACKAGE__');
    expect(kotlin).toContain('bonded://today?widget=');
    expect(kotlin).toContain(plugin.REFRESH_ACTION);
    for (const name of [
      'layout/bonded_widget_today_small.xml',
      'layout/bonded_widget_today_medium.xml',
      'layout/bonded_widget_countdown.xml',
      'layout/bonded_widget_partner_answered.xml',
      'xml/bonded_widget_today_info.xml',
      'xml/bonded_widget_your_turn_info.xml',
      'values/bonded_widget_colors.xml',
      'values-night/bonded_widget_colors.xml',
      'drawable/bonded_widget_mascot_waiting.xml',
      'drawable/bonded_widget_mascot_saving_a_seat.xml',
    ])
      expect(files[`res/${name}`]).toBeTruthy();
    expect(files['res/xml/bonded_widget_today_info.xml']).toContain('home_screen|keyguard');
    expect(files['res/values-night/bonded_widget_colors.xml']).not.toEqual(
      files['res/values/bonded_widget_colors.xml'],
    );
  });

  it('#286: every widget layout inflates in RemoteViews (allow-listed classes for minSdk only)', () => {
    // RemoteViews refuse any class without @RemoteView ("Class not allowed to be inflated"): the
    // whole widget then shows "Can't load widget". A plain <View> spacer did that on 38b.
    // https://developer.android.com/develop/ui/views/appwidgets/overview#layouts
    const toml = fs.readFileSync('node_modules/react-native/gradle/libs.versions.toml', 'utf8');
    const minSdk = Number(/^minSdk\s*=\s*"(\d+)"/m.exec(toml)?.[1]);
    expect(minSdk).toBeGreaterThanOrEqual(24);
    const allowed = new Set([
      'FrameLayout',
      'LinearLayout',
      'RelativeLayout',
      'GridLayout',
      'AnalogClock',
      'Button',
      'Chronometer',
      'ImageButton',
      'ImageView',
      'ProgressBar',
      'TextView',
      'TextClock',
      'ViewFlipper',
      'ListView',
      'GridView',
      'StackView',
      'AdapterViewFlipper',
      'ViewStub',
      // API 31+ only (CheckBox, Switch, RadioButton, RadioGroup): never while minSdk < 31.
      ...(minSdk >= 31 ? ['CheckBox', 'Switch', 'RadioButton', 'RadioGroup'] : []),
    ]);
    const files = plugin.androidFiles(opts());
    const layouts = Object.keys(files).filter((f) => /^res\/layout[^/]*\/.+\.xml$/.test(f));
    expect(layouts.length).toBeGreaterThanOrEqual(4);
    for (const name of layouts) {
      const xml = files[name]!.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>/, '');
      const tags = [...xml.matchAll(/<([A-Za-z][\w.]*)/g)].map((m) => m[1]!);
      expect(tags.length).toBeGreaterThan(0);
      expect({ name, notAllowed: tags.filter((tag) => !allowed.has(tag)) }).toEqual({
        name,
        notAllowed: [],
      });
    }
  });

  it('#287: 38 medium keeps the countdown on one line and gives the sub line 3 lines', () => {
    const xml = plugin.androidFiles(opts())['res/layout/bonded_widget_today_medium.xml']!;
    // The label sits above the timer, so "Next question in" can't squeeze the digits.
    expect(xml).toMatch(/android:id="@\+id\/bonded_timer_row"[^>]*android:orientation="vertical"/);
    expect(xml).toMatch(/<Chronometer[^>]*android:maxLines="1"/);
    expect(xml).toMatch(/android:id="@\+id\/bonded_sub"[^>]*android:maxLines="3"/);
  });

  it('converts the mascot SVG subset to a VectorDrawable', () => {
    const xml = svgToVector(
      '<svg viewBox="0 0 120 120"><g transform="translate(10 57) scale(0.62)">' +
        '<circle cx="24" cy="47" r="4.5" fill="#9CC9FF" opacity="0.5"></circle>' +
        '<path d="M0 0 H10" fill="none" stroke="#2A1407" stroke-width="2.5" stroke-linecap="round"></path>' +
        '</g><rect x="8" y="94" width="104" height="18" rx="6" fill="#B08A5A"></rect></svg>',
    );
    expect(xml).toContain('android:viewportWidth="120"');
    expect(xml).toMatch(
      /<group\s+android:translateX="10"\s+android:translateY="57"\s+android:scaleX="0.62"/,
    );
    expect(xml).toContain('android:fillAlpha="0.5"');
    expect(xml).toContain('android:strokeLineCap="round"');
    expect(xml).toContain('A6,6 0 0 1');
    expect(() => svgToVector('<svg><text>hi</text></svg>')).toThrow('unsupported element <text>');
  });
});
