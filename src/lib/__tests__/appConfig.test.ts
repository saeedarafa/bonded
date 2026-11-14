import type { ConfigContext, ExpoConfig } from 'expo/config';

import easJson from '../../../eas.json';
import tokens from '../../ui/tokens.json';
import { APP_DOMAIN, INVITE_BASE_URL, inviteDomain } from '../env';

/**
 * MOB-02 (D30): the bundle id, the link domain and the EAS profiles. The store records, AASA and
 * assetlinks are created from these values (ACCOUNTS 4, 5, LEAD-04), so they are pinned here.
 */
const saved = process.env.EXPO_PUBLIC_INVITE_DOMAIN;

function setDomain(value: string | undefined) {
  if (value === undefined) delete process.env.EXPO_PUBLIC_INVITE_DOMAIN;
  else process.env.EXPO_PUBLIC_INVITE_DOMAIN = value;
}

type AppConfigModule = { default: (ctx: ConfigContext) => ExpoConfig };

function loadConfig(domain?: string): ExpoConfig {
  setDomain(domain);
  let config: ExpoConfig | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../app.config') as AppConfigModule;
    const build = mod.default;
    config = build({ config: {} } as ConfigContext);
  });
  return config as ExpoConfig;
}

afterEach(() => {
  setDomain(saved);
});

describe('app.config (MOB-02, D30)', () => {
  it('uses com.hellobonded.app on both platforms and the bonded scheme', () => {
    const config = loadConfig();
    expect(config.ios?.bundleIdentifier).toBe('com.hellobonded.app');
    expect(config.android?.package).toBe('com.hellobonded.app');
    expect(config.scheme).toBe('bonded');
    expect(config.ios?.usesAppleSignIn).toBe(true);
  });

  it('registers hellobonded.com links natively even when the env is empty', () => {
    const config = loadConfig();
    expect(config.ios?.associatedDomains).toEqual(['applinks:hellobonded.com']);
    expect(config.android?.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'hellobonded.com', pathPrefix: '/j/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
  });

  it('adds a second link domain from the env, ignores the placeholder and duplicates', () => {
    const staging = loadConfig('staging.hellobonded.com');
    expect(staging.ios?.associatedDomains).toEqual([
      'applinks:hellobonded.com',
      'applinks:staging.hellobonded.com',
    ]);
    expect(staging.android?.intentFilters?.[0]?.data).toHaveLength(2);
    expect(loadConfig('[your-domain]').ios?.associatedDomains).toEqual([
      'applinks:hellobonded.com',
    ]);
    expect(loadConfig('hellobonded.com').ios?.associatedDomains).toEqual([
      'applinks:hellobonded.com',
    ]);
  });

  it('MOB-02c: registers only hellobonded.com and its subdomains, never another domain', () => {
    for (const other of ['example.com', 'nothellobonded.com', 'hellobonded.com.evil.io']) {
      const config = loadConfig(other);
      expect(config.ios?.associatedDomains).toEqual(['applinks:hellobonded.com']);
      expect(config.android?.intentFilters?.[0]?.data).toEqual([
        { scheme: 'https', host: 'hellobonded.com', pathPrefix: '/j/' },
      ]);
    }
  });

  it('keeps no trace of the old placeholder bundle id', () => {
    expect(JSON.stringify(loadConfig())).not.toContain('app.bonded.mobile');
  });
});

function pluginOptions(config: ExpoConfig, name: string): Record<string, unknown> {
  const entry = config.plugins?.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  expect(entry).toBeDefined();
  return (Array.isArray(entry) ? entry[1] : {}) as Record<string, unknown>;
}

describe('native config (REL-07)', () => {
  it('#272: no background audio (no UIBackgroundModes audio, no Android media foreground service)', () => {
    // expo-audio defaults enableBackgroundPlayback to true; sounds and voice play only in the app.
    expect(pluginOptions(loadConfig(), 'expo-audio')).toMatchObject({
      enableBackgroundPlayback: false,
      enableBackgroundRecording: false,
      recordAudioAndroid: true,
    });
  });

  it('#271: the launch screen uses the app background in light and dark (no white frame)', () => {
    const splash = pluginOptions(loadConfig(), 'expo-splash-screen');
    expect(splash.backgroundColor).toBe(tokens.color.light.bg);
    expect(splash.dark).toEqual({ backgroundColor: tokens.color.dark.bg });
    expect(JSON.stringify(splash)).not.toMatch(/#fff(fff)?\b/i);
  });
});

describe('invite domain (MOB-02, D30)', () => {
  it('is hellobonded.com', () => {
    expect(APP_DOMAIN).toBe('hellobonded.com');
    expect(INVITE_BASE_URL).toBe('https://hellobonded.com');
  });

  it.each([
    ['hellobonded.com', 'hellobonded.com'],
    ['[your-domain]', 'hellobonded.com'],
    ['', null],
    [undefined, null],
    ['https://hellobonded.com/', null],
    ['staging.hellobonded.com', 'staging.hellobonded.com'],
    ['HelloBonded.com', 'hellobonded.com'],
    ['example.com', null],
    ['nothellobonded.com', null],
    ['hellobonded.com.evil.io', null],
    ['hellobonded.com:8080', null],
  ])('EXPO_PUBLIC_INVITE_DOMAIN=%p -> %p', (value, expected) => {
    setDomain(value);
    expect(inviteDomain()).toBe(expected);
  });
});

describe('eas.json profiles (MOB-02)', () => {
  const build = easJson.build as Record<string, Record<string, unknown>>;

  it('has development (dev client), preview (internal) and production', () => {
    expect(build.development).toMatchObject({ developmentClient: true, distribution: 'internal' });
    expect(build['development-simulator']).toMatchObject({ ios: { simulator: true } });
    expect(build.preview).toMatchObject({ distribution: 'internal' });
    expect(build.production).toMatchObject({ autoIncrement: true });
    expect(build.production?.developmentClient).toBeUndefined();
  });

  it('every build links to hellobonded.com and holds no secret', () => {
    expect(build.base).toEqual({
      env: {
        EXPO_PUBLIC_INVITE_DOMAIN: 'hellobonded.com',
        // D62 (MOB-85): "Send feedback" (40), the support mailbox (PO 2026-11-13: live).
        EXPO_PUBLIC_SUPPORT_EMAIL: 'support@hellobonded.com',
        // D63 (MOB-87, PO 2026-11-14): masked replay under "Share usage data" in every build.
        EXPO_PUBLIC_ANALYTICS_REPLAY: '1',
        // MOB-24: a failed Sentry source-map upload never fails the build.
        SENTRY_ALLOW_FAILURE: 'true',
      },
    });
    for (const name of ['development', 'preview', 'production']) {
      expect(build[name]?.extends).toBe('base');
    }
    expect(JSON.stringify(easJson)).not.toMatch(/SERVICE_ROLE|SECRET|sk_|appl_|goog_/i);
  });

  it('D63: no profile overrides the replay flag set in base (one switch: "Share usage data")', () => {
    for (const [name, profile] of Object.entries(build)) {
      if (name === 'base') continue;
      const env = (profile.env ?? {}) as Record<string, string>;
      expect([name, env.EXPO_PUBLIC_ANALYTICS_REPLAY]).toEqual([name, undefined]);
    }
  });

  it('D63/SEC-23 A4: internal builds flag is_test_account; production never does', () => {
    const envOf = (n: string) => (build[n]?.env ?? {}) as Record<string, string>;
    expect(envOf('development').EXPO_PUBLIC_ANALYTICS_TEST_BUILD).toBe('1');
    expect(envOf('preview').EXPO_PUBLIC_ANALYTICS_TEST_BUILD).toBe('1');
    expect(build.store?.extends).toBe('preview');
    expect(envOf('production').EXPO_PUBLIC_ANALYTICS_TEST_BUILD).toBeUndefined();
    expect(envOf('base').EXPO_PUBLIC_ANALYTICS_TEST_BUILD).toBeUndefined();
  });
});

describe('app.config Android push (MOB-81, Firebase bonded-e9c69)', () => {
  const savedFile = process.env.GOOGLE_SERVICES_JSON;
  afterEach(() => {
    if (savedFile === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = savedFile;
  });

  it('reads google-services.json only from the GOOGLE_SERVICES_JSON env path', () => {
    process.env.GOOGLE_SERVICES_JSON = '/eas/build/files/google-services.json';
    expect(loadConfig().android?.googleServicesFile).toBe('/eas/build/files/google-services.json');
    delete process.env.GOOGLE_SERVICES_JSON;
    expect(loadConfig().android?.googleServicesFile).toBeUndefined();
  });
});

describe('app.config RevenueCat test key guard (MOB-81)', () => {
  type Guard = {
    assertNoRevenueCatTestKeyInProduction: (env: Record<string, string | undefined>) => void;
  };
  function guard(): Guard['assertNoRevenueCatTestKeyInProduction'] {
    let fn: Guard['assertNoRevenueCatTestKeyInProduction'] | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fn = (require('../../../app.config') as Guard).assertNoRevenueCatTestKeyInProduction;
    });
    return fn as Guard['assertNoRevenueCatTestKeyInProduction'];
  }

  it('throws for a test_ key on the production profile, either platform', () => {
    const check = guard();
    expect(() =>
      check({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'test_abc' }),
    ).toThrow(/EXPO_PUBLIC_REVENUECAT_IOS_KEY/);
    expect(() =>
      check({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: ' test_abc' }),
    ).toThrow(/EXPO_PUBLIC_REVENUECAT_ANDROID_KEY/);
  });

  it('allows real keys in production and test_ keys in development, preview and local', () => {
    const check = guard();
    expect(() =>
      check({
        EAS_BUILD_PROFILE: 'production',
        EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_abc',
        EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_abc',
      }),
    ).not.toThrow();
    expect(() => check({ EAS_BUILD_PROFILE: 'production' })).not.toThrow();
    for (const profile of ['development', 'preview', undefined]) {
      expect(() =>
        check({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'test_abc' }),
      ).not.toThrow();
    }
  });
});
