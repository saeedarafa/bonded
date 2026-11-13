import { createAdminClient } from '../_shared/admin.ts';
import { requireRevenueCatSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import {
  anonymous,
  type Change,
  object,
  snapshot,
  type SnapshotDeps,
  uuid,
  uuidShaped,
} from '../_shared/revenuecat.ts';

type Event = Record<string, unknown> & { id: string; type: string; event_timestamp_ms: number };
type Deps = SnapshotDeps & { admin?: Pick<ReturnType<typeof createAdminClient>, 'rpc'> };
const supported = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
  'TRANSFER',
  // Legacy alias event (older projects): refresh every identified id it names.
  'SUBSCRIBER_ALIAS',
]);
const millis = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 8640000000000000;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 50 && v.every((item) => typeof item === 'string');
const MAX_USERS = 10;
const MAX_SKEW_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const YEARLY_MIN_MS = 300 * 24 * HOUR_MS;

// BE-62 (c) / D61 (3): a store-side cancel the `cancel_offer` push may follow. Decided only from
// the canonical snapshot (RevenueCat REST), never from webhook fields: the person's own App Store
// subscription is active for at least another hour, will not renew, and is a trial or a yearly
// period (no product ids, CONTRACTS §6). Intro/prepaid periods already carry a discount. The
// database re-checks the entitlement and the once-per-person rule (`queue_cancel_offer`).
export const cancelOfferCandidate = (change: Change, now: number): boolean => {
  if (!change.is_active || change.will_renew || change.store !== 'app_store') return false;
  const end = change.expires_at === null ? NaN : Date.parse(change.expires_at);
  if (!(end > now + HOUR_MS)) return false;
  if (change.period_type === 'trial') return true;
  const start = change.period_started_at === null ? NaN : Date.parse(change.period_started_at);
  return change.period_type === 'normal' && end - start >= YEARLY_MIN_MS;
};

// BE-48 (D50): a purchase made on P3 before sign-in belongs to `$RCAnonymousID:…`; after
// `Purchases.logIn(uid)` RevenueCat lists the Supabase uid as app_user_id, original_app_user_id
// or in aliases. Every UUID found is refreshed from its own canonical snapshot, so an id named
// in an event can never receive more than RevenueCat itself reports for that id.
const identified = (event: Event): string[] | null => {
  const app = event.app_user_id;
  // A non-canonical spelling of a uid (BE-48c) is well-formed but foreign: it is filtered out
  // below like an anonymous id, so an event that names only such ids is acknowledged and ignored.
  if (typeof app !== 'string' || (!uuidShaped(app) && !anonymous(app))) return null;
  const original = event.original_app_user_id;
  if (original != null && typeof original !== 'string') return null;
  if (event.aliases != null && !strings(event.aliases)) return null;
  // Ids are used exactly as sent (RevenueCat app user ids are case-sensitive); only canonical
  // lower-case uids are kept, because the database write would case-fold any other spelling.
  return [...new Set([app, original, ...(event.aliases ?? []) as string[]].filter(uuid))];
};

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<boolean> = requireRevenueCatSecret,
  deps: Deps = {},
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  if (request.method !== 'POST') return error('BAD_REQUEST', 'Invalid webhook', 400);
  let event: Event;
  try {
    // Bound authenticated webhook bodies too; do not retain subscriber attributes or full payloads.
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 65536) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const raw = object(object(JSON.parse(new TextDecoder().decode(bytes)))?.event);
    if (
      !raw || typeof raw.id !== 'string' || raw.id.length < 1 || raw.id.length > 200 ||
      typeof raw.type !== 'string' || !millis(raw.event_timestamp_ms)
    ) throw new Error();
    event = raw as Event;
  } catch {
    return error('BAD_REQUEST', 'Invalid webhook', 400);
  }
  if (!supported.has(event.type)) return json({ ok: true });
  // BE-48b: every write is a fresh canonical snapshot, so it is ordered by when it was looked up,
  // not only by the event time. Otherwise a refund/cancel webhook delivered after a
  // `revenuecat-sync` (stamped with its lookup time) would be dropped as stale.
  const lookedUpAt = (deps.now?.() ?? new Date()).getTime();
  // BE-48c: an event time far in the future (clock skew, or a bad payload) is clamped to the
  // lookup time + 5 min, so it cannot freeze the row against every later (real) update.
  const occurredAt = Math.max(
    Math.min(event.event_timestamp_ms, lookedUpAt + MAX_SKEW_MS),
    lookedUpAt,
  );
  let changes: Change[];
  if (event.type === 'TRANSFER') {
    const arrays = [event.transferred_from, event.transferred_to];
    if (arrays.some((a) => !strings(a))) return error('BAD_REQUEST', 'Invalid webhook', 400);
    const users = [...new Set((arrays as string[][]).flat().filter(uuid))];
    if (!users.length) {
      log('revenuecat.anonymous_ignored');
      return json({ ok: true });
    }
    if (users.length > MAX_USERS) return error('BAD_REQUEST', 'Invalid webhook', 400);
    try {
      changes = await Promise.all(users.map((user) => snapshot(user, deps)));
    } catch {
      return error('INTERNAL_ERROR', 'Webhook processing failed', 500);
    }
  } else {
    const users = identified(event);
    if (!users || users.length > MAX_USERS) return error('BAD_REQUEST', 'Invalid webhook', 400);
    if (event.type !== 'SUBSCRIBER_ALIAS') {
      if (!Array.isArray(event.entitlement_ids)) {
        return error('BAD_REQUEST', 'Invalid webhook', 400);
      }
      if (!event.entitlement_ids.includes('premium')) return json({ ok: true });
    }
    // Anonymous only (no logIn yet): nothing to attach it to. `revenuecat-sync` after sign-in,
    // or the next aliased event, applies it to the right account.
    if (!users.length) {
      log('revenuecat.anonymous_ignored');
      return json({ ok: true });
    }
    if (anonymous(event.app_user_id)) log('revenuecat.alias_resolved', { users: users.length });
    try {
      changes = await Promise.all(users.map((user) => snapshot(user, deps)));
    } catch {
      return error('INTERNAL_ERROR', 'Webhook processing failed', 500);
    }
  }
  try {
    const admin = deps.admin ?? createAdminClient();
    const { error: dbError } = await admin.rpc(
      'apply_revenuecat_event',
      {
        p_event_id: event.id,
        p_occurred_at: new Date(occurredAt).toISOString(),
        p_changes: changes,
      },
    );
    if (dbError) throw new Error('DATABASE_FAILED');
    // BE-62 (c): after the entitlement write, queue the one `cancel_offer` push for a customer
    // cancel (auto-renew off; not a refund or billing error), or drop a pending one when auto-renew
    // is back on. Failures are a 500 so RevenueCat retries: the entitlement write above is
    // deduplicated by event id and the queue call is idempotent.
    const unsubscribed = event.type === 'CANCELLATION' && event.cancel_reason === 'UNSUBSCRIBE';
    for (const change of changes) {
      const cancelled = unsubscribed && cancelOfferCandidate(change, lookedUpAt);
      const renewsAgain = event.type === 'UNCANCELLATION' && change.will_renew;
      if (!cancelled && !renewsAgain) continue;
      const { error: queueError } = await admin.rpc(
        'queue_cancel_offer',
        {
          p_user: change.user_id,
          p_cancelled: cancelled,
          p_now: new Date(lookedUpAt).toISOString(),
        },
      );
      if (queueError) throw new Error('DATABASE_FAILED');
    }
    return json({ ok: true });
  } catch {
    return error('INTERNAL_ERROR', 'Webhook processing failed', 500);
  }
};
if (import.meta.main) Deno.serve((request) => handle(request));
