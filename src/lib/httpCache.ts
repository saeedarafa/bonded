import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * MOB-89 (#479): no Supabase response may land in the OS HTTP cache. Without this, iOS
 * `URLCache.shared` (`Library/Caches/<bundle id>/Cache.db`) and Android OkHttp's 10 MB disk cache
 * (`cacheDir/http-cache`, OkHttpClientProvider.createClientBuilder(context)) keep plain-text copies
 * of tokens (`auth/v1/*`, `mint_widget_token`) and answer / message bodies, and they survive
 * sign-out.
 *
 * Why a request header and not `fetch(url, { cache: 'no-store' })`: React Native's fetch is
 * whatwg-fetch over XMLHttpRequest. RCTNetworking (iOS) and NetworkingModule (Android) never read
 * the `cache` option, and whatwg-fetch turns `no-store` on a GET into an extra `_=<time>` query
 * parameter, which PostgREST would treat as a filter on a column `_` (400). A request
 * `Cache-Control: no-store` is honoured by both stacks instead: NSURLSession does not store a
 * response whose request or response says `no-store`, and OkHttp's `CacheStrategy.isCacheable`
 * returns false for it. `Pragma: no-cache` covers HTTP/1.0 intermediaries.
 *
 * Layers: (1) every Supabase request through `noStoreFetch` (the client's `global.fetch`, which
 * supabase-js also uses for auth, PostgREST, Storage and `functions.invoke`); (2) on iOS the bridge
 * module sets `URLCache.shared` to zero capacity at start; (3) `clearHttpCache()` empties the native
 * caches on sign-out and after account deletion. Nothing here logs.
 */

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function baseHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  if (init?.headers !== undefined) return new Headers(init.headers);
  if (typeof Request !== 'undefined' && input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

/** A fetch that adds `Cache-Control: no-store` (and `Pragma: no-cache`) to every request. */
export function createNoStoreFetch(next: FetchFn = (input, init) => fetch(input, init)): FetchFn {
  return (input, init) => {
    // Browsers: a non-safelisted header would add a CORS preflight to every call; the web build
    // has no OS-level response cache shared with other apps, so leave the request as it is.
    if (Platform.OS === 'web') return next(input, init);
    const headers = baseHeaders(input, init);
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) headers.set(name, value);
    return next(input, { ...init, headers });
  };
}

/** The Supabase client's `global.fetch` (src/lib/supabase.ts). */
export const noStoreFetch: FetchFn = createNoStoreFetch();

type HttpCacheModule = { clearHttpCache?: () => void };

let native: HttpCacheModule | null | undefined;

function load(): HttpCacheModule | null {
  if (native === undefined) {
    native =
      Platform.OS === 'ios' || Platform.OS === 'android'
        ? requireOptionalNativeModule<HttpCacheModule>('BondedWidgets')
        : null;
  }
  return native;
}

/**
 * Empty the OS HTTP cache of this app (iOS `URLCache.shared`, Android OkHttp `http-cache`).
 * No-op without the native function (Expo Go, web, Jest, an older binary). Never throws.
 */
export function clearHttpCache(): void {
  try {
    load()?.clearHttpCache?.();
  } catch {
    // Nothing to do: the request header already keeps new responses out of the cache.
  }
}

/** Tests: use a fake native module (null = none, undefined = load again). */
export function setHttpCacheModuleForTests(mod: HttpCacheModule | null | undefined): void {
  native = mod;
}
