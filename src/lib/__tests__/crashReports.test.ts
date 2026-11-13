import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import type { ConfigContext, ExpoConfig } from 'expo/config';

import easJson from '../../../eas.json';
import {
  crashReportOptions,
  crashReportsEnv,
  initCrashReports,
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  scrubUrl,
  setCrashReportsForTests,
  setCrashReportUser,
} from '../crashReports';

/**
 * MOB-24 (D54, ANALYTICS §1): Sentry is a no-op without a DSN, tags the environment, and nothing a
 * person wrote, is called or was sent survives `beforeSend` / `beforeBreadcrumb`.
 */

// Fixture strings (QA-08 style): none of them may appear in a scrubbed event.
const ANSWER = 'I loved the morning we walked to the lake QA08-ANSWER';
const MESSAGE = 'Miss you already, see you tonight QA08-MESSAGE';
const NAME = 'Maya Qa08name';
const PARTNER = 'Jonah Qa08partner';
const EMAIL = 'maya.qa08@bonded.test';
const CODE = 'BND·4827';
const CODE_PLAIN = 'BND4827';
// Built at runtime from obvious fakes, so the secret scanners (gitleaks) see no token literal.
const LINK_TOKEN = ['qa08', 'link', 'Ab9'.repeat(10)].join('_');
const JWT = [
  ['ey', 'JhbGciOiJIUzI1NiJ9'].join(''),
  ['ey', 'JzdWIiOiJxYTA4In0'].join(''),
  'fake-signature-qa08',
].join('.');
const KEY_DATE = 'Our first trip to Lisbon QA08-KEYDATE';
const FEEDBACK = 'The reveal animation is too slow QA08-FEEDBACK';
const PUSH = 'ExponentPushToken[qa08AbCdEfGhIjKl]';
const OTP = '123456';

const SECRETS = [
  'QA08-ANSWER',
  'QA08-MESSAGE',
  'Qa08name',
  'Qa08partner',
  EMAIL,
  'maya.qa08',
  '4827',
  LINK_TOKEN,
  JWT,
  'eyJhbGci',
  'QA08-KEYDATE',
  'QA08-FEEDBACK',
  'qa08AbCdEfGhIjKl',
  OTP,
  'Lisbon',
];

function expectClean(value: unknown) {
  const json = JSON.stringify(value);
  for (const secret of SECRETS) {
    expect(json).not.toContain(secret);
  }
}

const KEYS = ['EXPO_PUBLIC_SENTRY_DSN', 'EXPO_PUBLIC_APP_ENV'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  // Restore key by key: the transformed `process.env.X` reads keep the original object.
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setCrashReportsForTests();
});

describe('init (MOB-24)', () => {
  it('is a no-op without a DSN: the SDK is never loaded', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    const load = jest.fn();
    setCrashReportsForTests({ load });
    expect(initCrashReports()).toBe(false);
    setCrashReportUser('user-1');
    expect(load).not.toHaveBeenCalled();
  });

  it('a blank DSN counts as none', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = '   ';
    const load = jest.fn();
    setCrashReportsForTests({ load });
    expect(initCrashReports()).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('initialises once with the DSN, the environment and the scrubbers', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.de.sentry.io/2';
    process.env.EXPO_PUBLIC_APP_ENV = 'preview';
    const init = jest.fn();
    const setUser = jest.fn();
    setCrashReportsForTests({ load: () => ({ init, setUser }) });
    expect(initCrashReports()).toBe(true);
    expect(initCrashReports()).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][0];
    expect(options.dsn).toBe('https://abc@o1.ingest.de.sentry.io/2');
    expect(options.environment).toBe('preview');
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);

    setCrashReportUser('6b0c7e1e-0000-4000-8000-000000000001');
    expect(setUser).toHaveBeenLastCalledWith({ id: '6b0c7e1e-0000-4000-8000-000000000001' });
    setCrashReportUser(null);
    expect(setUser).toHaveBeenLastCalledWith(null);
  });

  it('never throws into the app when the SDK fails to load', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.de.sentry.io/2';
    setCrashReportsForTests({
      load: () => {
        throw new Error('native module missing');
      },
    });
    expect(initCrashReports()).toBe(false);
    expect(() => setCrashReportUser('u')).not.toThrow();
  });

  it('sets every privacy switch explicitly', () => {
    const o = crashReportOptions('dsn', 'production');
    expect(o).toMatchObject({
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      // Native iOS HTTP breadcrumbs bypass the JS scrubbers on native crashes (SEC review #441).
      enableNetworkBreadcrumbs: false,
      reportAccessibilityIdentifier: false,
      enableUserInteractionTracing: false,
      enableAutoPerformanceTracing: false,
      enableLogs: false,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
    expect(o.tracesSampleRate).toBeUndefined();
    expect(o.profilesSampleRate).toBeUndefined();
    expect(o.integrations).toBeUndefined(); // no replay or feedback integration added
    expect(o.beforeSendTransaction?.({} as never, {})).toBeNull();
  });
});

describe('environment tag (one Sentry project)', () => {
  it.each(['development', 'preview', 'production'] as const)('%s', (name) => {
    process.env.EXPO_PUBLIC_APP_ENV = name;
    expect(crashReportsEnv().environment).toBe(name);
  });

  it('anything else is development', () => {
    for (const value of [undefined, '', 'prod', 'store', 'PRODUCTION']) {
      if (value === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
      else process.env.EXPO_PUBLIC_APP_ENV = value;
      expect(crashReportsEnv().environment).toBe('development');
    }
  });

  type Profile = { extends?: string; env?: Record<string, string> };
  const profiles = easJson.build as Record<string, Profile>;
  function resolvedEnv(name: string): Record<string, string> {
    const p = profiles[name]!;
    return { ...(p.extends ? resolvedEnv(p.extends) : {}), ...(p.env ?? {}) };
  }

  it('every EAS build profile sets its environment', () => {
    expect(resolvedEnv('development').EXPO_PUBLIC_APP_ENV).toBe('development');
    expect(resolvedEnv('development-simulator').EXPO_PUBLIC_APP_ENV).toBe('development');
    expect(resolvedEnv('preview').EXPO_PUBLIC_APP_ENV).toBe('preview');
    expect(resolvedEnv('store').EXPO_PUBLIC_APP_ENV).toBe('preview');
    expect(resolvedEnv('production').EXPO_PUBLIC_APP_ENV).toBe('production');
  });

  it('no profile commits a Sentry auth token; a failed upload never fails the build', () => {
    expect(JSON.stringify(easJson)).not.toMatch(/SENTRY_AUTH_TOKEN|sntrys_/);
    expect(resolvedEnv('production').SENTRY_ALLOW_FAILURE).toBe('true');
  });
});

describe('Sentry config plugin (source maps)', () => {
  type AppConfigModule = {
    default: (ctx: ConfigContext) => ExpoConfig;
    sentryPlugin: (env: Record<string, string>) => [string, Record<string, unknown>];
  };
  function load(): AppConfigModule {
    let mod: AppConfigModule | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../../../app.config') as AppConfigModule;
    });
    return mod!;
  }

  it('is in the plugin list', () => {
    const config = load().default({ config: {} } as ConfigContext);
    const names = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('@sentry/react-native/expo');
  });

  it('uploads only with a token, an org and a project; never puts the token in the config', () => {
    const { sentryPlugin } = load();
    expect(sentryPlugin({})[1]).toEqual({ disableAutoUpload: true });
    expect(sentryPlugin({ SENTRY_ORG: 'o', SENTRY_PROJECT: 'p' })[1]).toEqual({
      organization: 'o',
      project: 'p',
      disableAutoUpload: true,
    });
    const full = sentryPlugin({
      SENTRY_ORG: 'o',
      SENTRY_PROJECT: 'p',
      SENTRY_AUTH_TOKEN: 'sntrys_secret',
    });
    expect(full[1]).toEqual({ organization: 'o', project: 'p', disableAutoUpload: false });
    expect(JSON.stringify(full)).not.toContain('sntrys_secret');
  });
});

describe('scrubUrl / scrubText', () => {
  it('drops query strings and fragments, reduces invite codes in paths', () => {
    expect(scrubUrl(`https://hellobonded.com/j/${CODE_PLAIN}?t=${LINK_TOKEN}`)).toBe(
      'https://hellobonded.com/j/[code]',
    );
    expect(scrubUrl(`bonded://join/${CODE_PLAIN}#t=${LINK_TOKEN}`)).toBe('bonded://join/[code]');
    expect(
      scrubUrl(
        `https://x.supabase.co/rest/v1/answers?select=*&body=eq.${encodeURIComponent(ANSWER)}`,
      ),
    ).toBe('https://x.supabase.co/rest/v1/answers');
    expect(scrubUrl(`https://x.supabase.co/auth/v1/verify#access_token=${JWT}`)).toBe(
      'https://x.supabase.co/auth/v1/verify',
    );
  });

  it('replaces emails, tokens, codes and Postgres row data in free text', () => {
    const out = scrubText(
      [
        `Sign-in failed for ${EMAIL}`,
        `invite ${CODE} and ${CODE_PLAIN} code=4827`,
        `Bearer ${JWT}`,
        `push ${PUSH}`,
        `link token ${LINK_TOKEN}`,
        `new row for relation "answers" violates check constraint. Failing row contains (1, ${ANSWER}, ${NAME}).`,
        `Key (title)=(${KEY_DATE}) already exists.`,
        `invalid input syntax for type uuid: "${MESSAGE}"`,
        `see https://hellobonded.com/j/${CODE_PLAIN}?t=${LINK_TOKEN}`,
        `{"p_code":"4827","p_token":"${LINK_TOKEN}"}`,
        `otp: ${OTP}`,
      ].join('\n'),
    );
    expectClean(out);
    expect(out).toContain('Sign-in failed for [email]');
    expect(out).toContain('Failing row contains ([redacted])');
  });
});

describe('beforeSend', () => {
  function fixtureEvent(): ErrorEvent {
    return {
      type: undefined,
      message: `Could not send "${MESSAGE}" for ${EMAIL}`,
      server_name: "Maya's iPhone",
      transaction: `/j/${CODE_PLAIN}?t=${LINK_TOKEN}`,
      user: {
        id: 'u-1',
        email: EMAIL,
        username: NAME,
        ip_address: '203.0.113.9',
        name: NAME,
      } as never,
      request: {
        url: `https://x.supabase.co/rest/v1/rpc/accept_invite?p_code=4827`,
        method: 'POST',
        data: { p_code: '4827', p_token: LINK_TOKEN },
        headers: { Authorization: `Bearer ${JWT}` },
        cookies: { sb: JWT },
        query_string: `t=${LINK_TOKEN}`,
      },
      exception: {
        values: [
          {
            type: 'PostgrestError',
            value: `duplicate key value violates unique constraint. Key (body)=(${ANSWER}) already exists.`,
            stacktrace: {
              frames: [
                { filename: 'app:///index.bundle', function: 'submit', vars: { answer: ANSWER } },
              ],
            },
          },
        ],
      },
      tags: { screen: 'today/answer', partner_name: PARTNER, note: FEEDBACK },
      extra: {
        answer: ANSWER,
        body: MESSAGE,
        partnerName: PARTNER,
        display_name: NAME,
        email: EMAIL,
        title: KEY_DATE,
        feedback: FEEDBACK,
        invite_code: CODE,
        push_token: PUSH,
        details: `Failing row contains (${ANSWER})`,
        hint: MESSAGE,
        nested: { message: MESSAGE, info: `failed for ${EMAIL}`, rows: [{ text: ANSWER }] },
        status: 409,
      },
      contexts: {
        device: { name: "Maya's iPhone", model: 'iPhone16,2', family: 'iOS' },
        os: { name: 'iOS', version: '18.0' },
        app: { app_version: '1.0.0' },
        supabase: {
          code: '23505',
          details: `Key (title)=(${KEY_DATE})`,
          hint: NAME,
          message: MESSAGE,
        },
        partner: { name: PARTNER },
      },
      breadcrumbs: [
        {
          category: 'console',
          level: 'log',
          message: `answer: ${ANSWER}`,
          data: { arguments: [ANSWER] },
        },
        { category: 'touch', message: `Pressed ${PARTNER}`, data: { label: PARTNER } },
        {
          category: 'fetch',
          type: 'http',
          data: {
            method: 'POST',
            url: `https://x.supabase.co/rest/v1/messages?body=${MESSAGE}`,
            status_code: 201,
            request_body: MESSAGE,
            response_body: ANSWER,
          },
        },
        {
          category: 'navigation',
          data: { from: '/today', to: `/j/${CODE_PLAIN}?t=${LINK_TOKEN}` },
        },
        {
          category: 'app',
          message: `Saved key date ${KEY_DATE} for ${EMAIL}`,
          data: { title: KEY_DATE },
        },
      ],
    } as ErrorEvent;
  }

  it('no fixture string survives', () => {
    const out = scrubEvent(fixtureEvent());
    expectClean(out);
  });

  it('keeps what debugging needs', () => {
    const out = scrubEvent(fixtureEvent())!;
    expect(out.user).toEqual({ id: 'u-1' });
    expect(out.server_name).toBeUndefined();
    expect(out.request).toEqual({
      url: 'https://x.supabase.co/rest/v1/rpc/accept_invite',
      method: 'POST',
    });
    expect(out.transaction).toBe('/j/[code]');
    expect(out.tags).toEqual({ screen: 'today/answer' });
    expect(out.extra).toEqual({ nested: { info: 'failed for [email]', rows: [{}] }, status: 409 });
    expect(out.contexts?.device).toEqual({ model: 'iPhone16,2', family: 'iOS' });
    expect(out.contexts?.os).toEqual({ name: 'iOS', version: '18.0' });
    expect(out.contexts?.supabase).toBeUndefined();
    expect(out.contexts?.partner).toBeUndefined();
    expect(out.exception?.values?.[0]?.type).toBe('PostgrestError');
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: 'app:///index.bundle',
      function: 'submit',
    });
    expect(out.breadcrumbs?.map((b) => b.category)).toEqual([
      'console',
      'fetch',
      'navigation',
      'app',
    ]);
  });

  it('#444: a JSON-stringified PostgREST error (escaped quotes) in a message is scrubbed', () => {
    const json = JSON.stringify({ code: '22001', message: `value "${ANSWER}" too long` });
    const value = `save failed: ${json}`;
    const out = scrubEvent({
      type: undefined,
      message: value,
      exception: { values: [{ type: 'Error', value }] },
    } as ErrorEvent);
    expectClean(out);
    expect(out?.exception?.values?.[0]?.value).toContain('save failed: {');
    // Escaped pair outside a complete quoted string, and an escape inside a closed value.
    expect(scrubText(`value \\"${ANSWER}\\" too long`)).not.toContain(ANSWER);
    expect(scrubText(`"a \\" b ${ANSWER}"`)).toBe('"[redacted]"');
    expect(scrubText(`x "${ANSWER}" y "${NAME}"`)).toBe('x "[redacted]" y "[redacted]"');
  });

  it('#444: nested values in SDK contexts are scrubbed; the Redux `state` context is dropped', () => {
    const out = scrubEvent({
      type: undefined,
      contexts: {
        state: { state: { type: 'redux', value: { draft: { answer: ANSWER, partner: NAME } } } },
        app: { app_version: '1.0.0', extra_info: { note: FEEDBACK, label: `for ${EMAIL}` } },
        device: { name: "Maya's iPhone", model: 'iPhone16,2', memory: { free: 1 } },
      },
    } as ErrorEvent)!;
    expectClean(out);
    expect(JSON.stringify(out)).not.toContain(NAME);
    expect(out.contexts?.state).toBeUndefined();
    expect(out.contexts?.app).toEqual({
      app_version: '1.0.0',
      extra_info: { label: 'for [email]' },
    });
    expect(out.contexts?.device).toEqual({ model: 'iPhone16,2', memory: { free: 1 } });
  });

  it('exception mechanism.data and thread frames are scrubbed', () => {
    const out = scrubEvent({
      type: undefined,
      exception: {
        values: [
          {
            type: 'Error',
            value: 'x',
            mechanism: {
              type: 'onunhandledrejection',
              handled: false,
              data: { message: MESSAGE, reason: `"${ANSWER}"`, function: 'save' },
            },
          },
        ],
      },
      threads: {
        values: [{ id: 1, stacktrace: { frames: [{ function: 'f', vars: { body: MESSAGE } }] } }],
      },
    } as ErrorEvent)!;
    expectClean(out);
    expect(out.exception?.values?.[0]?.mechanism).toEqual({
      type: 'onunhandledrejection',
      handled: false,
      data: { reason: '"[redacted]"', function: 'save' },
    });
    expect(out.threads?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({ function: 'f' });
  });

  it('an event without a user gets none', () => {
    expect(scrubEvent({ type: undefined, message: 'x' } as ErrorEvent)?.user).toBeUndefined();
  });
});

describe('beforeBreadcrumb', () => {
  it('console: only the level stays', () => {
    const out = scrubBreadcrumb({
      category: 'console',
      level: 'warning',
      message: `draft ${ANSWER}`,
      data: { arguments: [MESSAGE, { email: EMAIL }], logger: 'console' },
      timestamp: 1,
    });
    expect(out).toEqual({ category: 'console', level: 'warning', timestamp: 1, type: undefined });
  });

  it('touch and ui breadcrumbs are dropped', () => {
    expect(scrubBreadcrumb({ category: 'touch', message: PARTNER })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.click', message: NAME })).toBeNull();
  });

  it('http: method, status and a scrubbed URL only', () => {
    const out = scrubBreadcrumb({
      category: 'xhr',
      type: 'http',
      data: {
        method: 'GET',
        status_code: 200,
        url: `https://x.supabase.co/rest/v1/key_dates?title=eq.${KEY_DATE}`,
        request_body_size: 10,
        response_body: FEEDBACK,
      },
    });
    expect(out?.data).toEqual({
      method: 'GET',
      status_code: 200,
      url: 'https://x.supabase.co/rest/v1/key_dates',
    });
  });

  it('navigation: no query strings or invite codes', () => {
    const out = scrubBreadcrumb({
      category: 'navigation',
      message: `to ${NAME}`,
      data: {
        from: `/join/${CODE_PLAIN}`,
        to: `/j/${CODE_PLAIN}?t=${LINK_TOKEN}`,
        params: { name: NAME },
      },
    });
    expect(out?.data).toEqual({ from: '/join/[code]', to: '/j/[code]' });
    expectClean(out);
  });

  it('other breadcrumbs: message scrubbed and free-text keys removed', () => {
    const crumbs: Breadcrumb[] = [
      { category: 'app', message: `sent to ${EMAIL} with ${PUSH}`, data: { answer: ANSWER } },
      {
        category: 'sentry.event',
        message: `invite ${CODE}`,
        data: { partner_name: PARTNER, feedback: FEEDBACK },
      },
      { category: 'query', data: { key_dates: [{ title: KEY_DATE }], body: MESSAGE, otp: OTP } },
    ];
    for (const c of crumbs) expectClean(scrubBreadcrumb(c));
  });
});
