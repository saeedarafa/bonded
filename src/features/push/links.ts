/**
 * Push tap routing (MOB-15, CONTRACTS §5). Every push carries `data.type` and `data.url`
 * (`bonded://…`). Only the five documented link shapes open a screen; anything else falls back to
 * the screen for its type, or to Today. A push can never open an arbitrary route.
 */
export const PUSH_TYPES = [
  'ritual_reminder',
  'partner_answered',
  'both_answered',
  'thread_activity',
  'last_call',
  'nudge',
  'partner_joined',
  'partner_premium',
  'weekly_recap',
] as const;

export type PushType = (typeof PUSH_TYPES)[number];

export type PushData = { type: PushType | null; url: string | null };

/** In-app paths a push may open. `/question/<id>` decides between 19, 20, 21 and 23 itself. */
export type PushHref =
  '/today' | '/packs' | '/history/recap' | `/question/${string}` | `/question/${string}/thread`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Screen per type when the url is missing or unusable (it never carries an id). */
const TYPE_FALLBACK: Record<PushType, PushHref> = {
  ritual_reminder: '/today',
  partner_answered: '/today',
  both_answered: '/today',
  thread_activity: '/today',
  last_call: '/today',
  nudge: '/today',
  partner_joined: '/today',
  partner_premium: '/packs',
  weekly_recap: '/history/recap',
};

function isPushType(value: unknown): value is PushType {
  return typeof value === 'string' && (PUSH_TYPES as readonly string[]).includes(value);
}

/** Reads `data` from a notification without trusting its shape. */
export function parsePushData(data: unknown): PushData {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    type: isPushType(record.type) ? record.type : null,
    url: typeof record.url === 'string' ? record.url : null,
  };
}

/** `bonded://question/<id>/thread` (or `bonded:///question/…`) to the allowed in-app path, else null. */
export function hrefFromUrl(url: string): PushHref | null {
  const match = /^bonded:\/\/\/?([^?#]*)/i.exec(url.trim());
  if (!match) return null;
  const parts = (match[1] ?? '').split('/').filter(Boolean);
  const [head, id, tail] = parts;
  if (parts.length === 1 && head === 'today') return '/today';
  if (parts.length === 1 && head === 'packs') return '/packs';
  if (parts.length === 2 && head === 'history' && id === 'recap') return '/history/recap';
  if (head === 'question' && id && UUID.test(id)) {
    const cq = id.toLowerCase();
    if (parts.length === 2) return `/question/${cq}`;
    if (parts.length === 3 && tail === 'thread') return `/question/${cq}/thread`;
  }
  return null;
}

/** Where a tap on this push goes. Unknown pushes open Today rather than nothing. */
export function hrefForPush(data: PushData): PushHref {
  const fromUrl = data.url ? hrefFromUrl(data.url) : null;
  if (fromUrl) return fromUrl;
  return data.type ? TYPE_FALLBACK[data.type] : '/today';
}

/**
 * True when the person is already looking at the screen a push points to, so the foreground
 * banner would only repeat what realtime already shows.
 */
export function isOnTarget(pathname: string, href: PushHref): boolean {
  if (href.startsWith('/question/')) {
    if (href.endsWith('/thread')) return pathname === '/today/thread';
    return ['/today/answer', '/today/reveal', '/today/revealed'].includes(pathname);
  }
  if (href === '/packs') return pathname === '/packs' || pathname.startsWith('/packs/');
  return pathname === href;
}
