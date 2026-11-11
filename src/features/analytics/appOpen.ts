import type { EventProps } from '@/lib/analytics';

/**
 * Where an `app_opened` came from (ANALYTICS §3.1). The open waits a moment (useAnalytics) so a
 * push tap or a link that launched or resumed the app can name itself; otherwise it was the icon.
 * Only the kind is kept: never the URL, the push title or body.
 */
export type OpenSource = Pick<EventProps<'app_opened'>, 'source' | 'push_type'>;

let waiting = false;
let pending: OpenSource | null = null;
let coldStartTracked = false;

/** A push tap or a link that opened the app. A push wins over a link (it carries its type). */
export function noteOpenSource(source: OpenSource): void {
  if (waiting && pending?.source !== 'push') pending = source;
}

export function beginOpen(): void {
  waiting = true;
  pending = null;
}

export function takeOpenSource(): OpenSource {
  const source = pending ?? { source: 'icon' };
  waiting = false;
  pending = null;
  return source;
}

export function cancelOpen(): void {
  waiting = false;
  pending = null;
}

/** True once per JS runtime: the cold start. */
export function claimColdStart(): boolean {
  if (coldStartTracked) return false;
  coldStartTracked = true;
  return true;
}

/** Tests: forget the cold start and any pending source. */
export function resetAppOpenForTests(): void {
  waiting = false;
  pending = null;
  coldStartTracked = false;
}

/** `bonded://j/…`, `https://trybonded.com/j/…`, `…/auth/callback`: the kind only, never the URL. */
export function deepLinkKind(url: string): EventProps<'deep_link_opened'> {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url);
  if (!match) return { kind: 'other', valid: false };
  let rest = match[2] ?? '';
  // https://host/path: drop the host. bonded://j/CODE: the "host" is the first path segment.
  if (/^https?$/i.test(match[1] ?? '')) rest = rest.replace(/^[^/?#]*/, '');
  const path = `/${rest.replace(/^\/+/, '').split(/[?#]/)[0] ?? ''}`;
  if (/^\/j\/[^/]+\/?$/.test(path)) return { kind: 'invite', valid: true };
  if (/^\/auth\/callback\/?$/.test(path)) return { kind: 'auth', valid: true };
  return { kind: 'other', valid: false };
}
