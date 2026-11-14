import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import {
  clearHttpCache,
  createNoStoreFetch,
  noStoreFetch,
  setHttpCacheModuleForTests,
} from '@/lib/httpCache';

type Fs = {
  readFileSync: (p: string, enc: 'utf8') => string;
  readdirSync: (
    p: string,
    o: { withFileTypes: true },
  ) => { name: string; isDirectory(): boolean }[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as Fs;
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(`${ROOT}/${rel}`, 'utf8');

/**
 * MOB-89 (#479): Supabase responses (tokens, answer / message text) must never reach the OS HTTP
 * cache (iOS URLCache `Cache.db`, Android OkHttp `http-cache`).
 */

type Call = { url: string; init: RequestInit | undefined };

function recorder() {
  const calls: Call[] = [];
  const next = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : String(input), init });
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });
  return { calls, next };
}

const headerOf = (call: Call | undefined, name: string) =>
  new Headers(call?.init?.headers).get(name);

describe('createNoStoreFetch', () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
  });

  it('adds Cache-Control: no-store and Pragma: no-cache, keeping the other headers', async () => {
    const { calls, next } = recorder();
    await createNoStoreFetch(next)('https://x.supabase.co/rest/v1/answers?select=body', {
      method: 'GET',
      headers: { apikey: 'anon', Authorization: 'Bearer jwt' },
    });
    expect(headerOf(calls[0], 'cache-control')).toBe('no-store');
    expect(headerOf(calls[0], 'pragma')).toBe('no-cache');
    expect(headerOf(calls[0], 'apikey')).toBe('anon');
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer jwt');
  });

  it('keeps a Headers object, the method and the body; overrides a caller cache header', async () => {
    const { calls, next } = recorder();
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=60',
    });
    await createNoStoreFetch(next)('https://x.supabase.co/rest/v1/rpc/mint_widget_token', {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe('{}');
    expect(headerOf(calls[0], 'content-type')).toBe('application/json');
    expect(headerOf(calls[0], 'cache-control')).toBe('no-store');
  });

  it("never sets fetch's `cache` option and never changes the URL", async () => {
    // whatwg-fetch (RN's fetch) turns `cache: 'no-store'` on a GET into `?_=<time>`, which
    // PostgREST would read as a filter on a column `_`.
    const { calls, next } = recorder();
    const url = 'https://x.supabase.co/rest/v1/thread_messages?select=body&couple_id=eq.c1';
    await createNoStoreFetch(next)(url, { headers: {} });
    expect(calls[0]?.url).toBe(url);
    expect(calls[0]?.init).not.toHaveProperty('cache');
  });

  it('keeps the headers of a Request input when init has none', async () => {
    const { calls, next } = recorder();
    await createNoStoreFetch(next)(
      new Request('https://x.supabase.co/auth/v1/user', { headers: { apikey: 'anon' } }),
    );
    expect(headerOf(calls[0], 'apikey')).toBe('anon');
    expect(headerOf(calls[0], 'cache-control')).toBe('no-store');
  });

  it('works without init', async () => {
    const { calls, next } = recorder();
    await createNoStoreFetch(next)('https://x.supabase.co/auth/v1/settings');
    expect(headerOf(calls[0], 'cache-control')).toBe('no-store');
  });

  it('leaves web requests alone (no CORS preflight; no shared OS cache)', async () => {
    Platform.OS = 'web';
    const { calls, next } = recorder();
    const init = { headers: { apikey: 'anon' } };
    await createNoStoreFetch(next)('https://x.supabase.co/rest/v1/answers', init);
    expect(calls[0]?.init).toBe(init);
  });

  it('noStoreFetch uses the global fetch', async () => {
    const original = globalThis.fetch;
    const { calls, next } = recorder();
    globalThis.fetch = next as unknown as typeof fetch;
    try {
      await noStoreFetch('https://x.supabase.co/auth/v1/settings');
    } finally {
      globalThis.fetch = original;
    }
    expect(headerOf(calls[0], 'cache-control')).toBe('no-store');
  });
});

describe('a supabase-js client with the no-store fetch', () => {
  // A dummy key (not a real credential).
  const ANON = 'test-anon-key';

  it('sends no-store on PostgREST selects, RPCs, auth verify and functions, URLs untouched', async () => {
    const { calls, next } = recorder();
    const client = createClient('https://x.supabase.co', ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createNoStoreFetch(next) },
    });

    await client.from('answers').select('body').eq('couple_id', 'c1');
    await client.from('thread_messages').select('body');
    await client.rpc('mint_widget_token');
    await client.auth.verifyOtp({ email: 'a@example.test', token: '123456', type: 'email' });
    await client.functions.invoke('delete-account', { method: 'POST' });

    const paths = calls.map((c) => new URL(c.url).pathname);
    expect(paths).toEqual([
      '/rest/v1/answers',
      '/rest/v1/thread_messages',
      '/rest/v1/rpc/mint_widget_token',
      '/auth/v1/verify',
      '/functions/v1/delete-account',
    ]);
    for (const call of calls) {
      expect(headerOf(call, 'cache-control')).toBe('no-store');
      expect(new URL(call.url).searchParams.has('_')).toBe(false);
    }
  });

  it('src/lib/supabase.ts passes noStoreFetch as the client global.fetch', () => {
    jest.isolateModules(() => {
      const created: unknown[][] = [];
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: (...args: unknown[]) => {
          created.push(args);
          return { auth: {} };
        },
      }));
      jest.doMock('@/lib/env', () => ({
        supabaseEnv: () => ({ url: 'https://x.supabase.co', anonKey: 'test-anon-key' }),
      }));
      jest.doMock('@/lib/storage', () => ({ authStorage: {} }));
      jest.requireActual<object>('@/lib/supabase');
      const { noStoreFetch: wrapped } = jest.requireActual<{ noStoreFetch: unknown }>(
        '@/lib/httpCache',
      );
      const options = created[0]?.[2] as { global?: { fetch?: unknown } };
      expect(options.global?.fetch).toBe(wrapped);
    });
  });

  it('no other app code calls fetch directly (everything goes through the client)', () => {
    const direct = /(^|[^A-Za-z0-9_.])fetch\(|globalThis\.fetch|new XMLHttpRequest/;
    const offenders: string[] = [];
    const walk = (rel: string) => {
      for (const entry of fs.readdirSync(`${ROOT}/${rel}`, { withFileTypes: true })) {
        const path = `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path);
        } else if (/\.tsx?$/.test(entry.name) && path !== 'src/lib/httpCache.ts') {
          if (direct.test(read(path))) offenders.push(path);
        }
      }
    };
    walk('src');
    walk('app');
    if (direct.test(read('index.ts'))) offenders.push('index.ts');
    expect(offenders).toEqual([]);
  });
});

describe('clearHttpCache', () => {
  afterEach(() => setHttpCacheModuleForTests(undefined));

  it('calls the native function', () => {
    const native = jest.fn();
    setHttpCacheModuleForTests({ clearHttpCache: native });
    clearHttpCache();
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without the module or without the function (older binary)', () => {
    setHttpCacheModuleForTests(null);
    expect(() => clearHttpCache()).not.toThrow();
    setHttpCacheModuleForTests({});
    expect(() => clearHttpCache()).not.toThrow();
  });

  it('never throws', () => {
    setHttpCacheModuleForTests({
      clearHttpCache: () => {
        throw new Error('native');
      },
    });
    expect(() => clearHttpCache()).not.toThrow();
  });

  it('never logs', () => {
    const src = read('src/lib/httpCache.ts');
    expect(src).not.toMatch(/console\.|Sentry|captureException|track\(/);
  });
});

describe('native side (plugins/widgets/modules/bonded-widgets)', () => {
  const mod = 'plugins/widgets/modules/bonded-widgets';

  it('iOS swaps URLCache.shared for a zero-capacity cache at start and clears it on demand', () => {
    const swift = read(`${mod}/ios/BondedWidgetsModule.swift`);
    expect(swift).toMatch(/OnCreate\s*\{\s*BondedWidgetsModule\.disableHttpCache\(\)/);
    expect(swift).toContain('URLCache(memoryCapacity: 0, diskCapacity: 0, directory: nil)');
    expect(swift).toMatch(
      /Function\("clearHttpCache"\)\s*\{\s*URLCache\.shared\.removeAllCachedResponses\(\)/,
    );
    expect(swift).not.toMatch(/\bprint\(|NSLog|os_log|Logger\(/);
  });

  it("Android empties OkHttp's http-cache directory on demand", () => {
    const kt = read(`${mod}/android/src/main/java/com/hellobonded/widgets/BondedWidgetsModule.kt`);
    expect(kt).toContain('Function("clearHttpCache")');
    expect(kt).toContain('const val HTTP_CACHE_DIR = "http-cache"');
    expect(kt).not.toMatch(/Log\.|println/);
    // The directory React Native's NetworkingModule client caches in.
    const provider = read(
      'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/network/OkHttpClientProvider.kt',
    );
    expect(provider).toContain('File(context.cacheDir, "http-cache")');
  });
});
