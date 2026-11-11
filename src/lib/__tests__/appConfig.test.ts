import type { ConfigContext, ExpoConfig } from 'expo/config';

import easJson from '../../../eas.json';
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
  it('uses com.trybonded.app on both platforms and the bonded scheme', () => {
    const config = loadConfig();
    expect(config.ios?.bundleIdentifier).toBe('com.trybonded.app');
    expect(config.android?.package).toBe('com.trybonded.app');
    expect(config.scheme).toBe('bonded');
    expect(config.ios?.usesAppleSignIn).toBe(true);
  });

  it('registers trybonded.com links natively even when the env is empty', () => {
    const config = loadConfig();
    expect(config.ios?.associatedDomains).toEqual(['applinks:trybonded.com']);
    expect(config.android?.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'trybonded.com', pathPrefix: '/j/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
  });

  it('adds a second link domain from the env, ignores the placeholder and duplicates', () => {
    const staging = loadConfig('staging.trybonded.com');
    expect(staging.ios?.associatedDomains).toEqual([
      'applinks:trybonded.com',
      'applinks:staging.trybonded.com',
    ]);
    expect(staging.android?.intentFilters?.[0]?.data).toHaveLength(2);
    expect(loadConfig('[your-domain]').ios?.associatedDomains).toEqual(['applinks:trybonded.com']);
    expect(loadConfig('trybonded.com').ios?.associatedDomains).toEqual(['applinks:trybonded.com']);
  });

  it('keeps no trace of the old placeholder bundle id', () => {
    expect(JSON.stringify(loadConfig())).not.toContain('app.bonded.mobile');
  });
});

describe('invite domain (MOB-02, D30)', () => {
  it('is trybonded.com', () => {
    expect(APP_DOMAIN).toBe('trybonded.com');
    expect(INVITE_BASE_URL).toBe('https://trybonded.com');
  });

  it.each([
    ['trybonded.com', 'trybonded.com'],
    ['[your-domain]', 'trybonded.com'],
    ['', null],
    [undefined, null],
    ['https://trybonded.com/', null],
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

  it('every build links to trybonded.com and holds no secret', () => {
    expect(build.base).toEqual({ env: { EXPO_PUBLIC_INVITE_DOMAIN: 'trybonded.com' } });
    for (const name of ['development', 'preview', 'production']) {
      expect(build[name]?.extends).toBe('base');
    }
    expect(JSON.stringify(easJson)).not.toMatch(/SERVICE_ROLE|SECRET|sk_|appl_|goog_/i);
  });
});
