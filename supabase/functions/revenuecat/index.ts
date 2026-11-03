import { createAdminClient } from '../_shared/admin.ts';
import { requireRevenueCatSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';

type Change = {
  user_id: string;
  is_active: boolean;
  product_id: string | null;
  store: string | null;
  expires_at: string | null;
};
type Event = Record<string, unknown> & { id: string; type: string; event_timestamp_ms: number };
type Deps = {
  admin?: Pick<ReturnType<typeof createAdminClient>, 'rpc'>;
  fetch?: typeof fetch;
  getEnv?: (name: string) => string | undefined;
  now?: () => Date;
};
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
]);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const millis = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 8640000000000000;
const date = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error('INVALID_SNAPSHOT');
  return new Date(v).toISOString();
};

// Refresh the canonical premium entitlement from the fixed RevenueCat host. An expiration
// for one product must not revoke another active product; TRANSFER has no product/expiry.
const snapshot = async (user: string, deps: Deps): Promise<Change> => {
  const key = (deps.getEnv ?? Deno.env.get)('REVENUECAT_REST_API_KEY');
  if (!key) throw new Error('MISCONFIGURED');
  const response = await (deps.fetch ?? fetch)(
    `https://api.revenuecat.com/v1/subscribers/${user}`,
    { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw new Error('SUBSCRIBER_LOOKUP_FAILED');
  const subscriber = object(object(await response.json())?.subscriber);
  const entitlements = object(subscriber?.entitlements);
  if (!subscriber || !entitlements) throw new Error('INVALID_SNAPSHOT');
  const premium = object(entitlements.premium);
  if (entitlements.premium != null && !premium) throw new Error('INVALID_SNAPSHOT');
  if (!premium) {
    return { user_id: user, is_active: false, product_id: null, store: null, expires_at: null };
  }
  if (
    typeof premium.product_identifier !== 'string' || premium.product_identifier.length < 1 ||
    premium.product_identifier.length > 200
  ) throw new Error('INVALID_SNAPSHOT');
  const expires = date(premium.expires_date);
  const purchases = object(subscriber.non_subscriptions)?.[premium.product_identifier];
  const subscription = object(object(subscriber.subscriptions)?.[premium.product_identifier]) ??
    object(Array.isArray(purchases) ? purchases.at(-1) : null);
  return {
    user_id: user,
    is_active: expires === null || Date.parse(expires) > (deps.now?.() ?? new Date()).getTime(),
    product_id: premium.product_identifier,
    store: typeof subscription?.store === 'string' ? subscription.store.toLowerCase() : null,
    expires_at: expires,
  };
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
  if (typeof event.app_user_id === 'string' && event.app_user_id.startsWith('$RCAnonymousID:')) {
    log('revenuecat.anonymous_ignored');
    return json({ ok: true });
  }
  let changes: Change[];
  if (event.type === 'TRANSFER') {
    const arrays = [event.transferred_from, event.transferred_to];
    if (
      arrays.some((a) => !Array.isArray(a) || a.length > 50 || a.some((v) => typeof v !== 'string'))
    ) {
      return error('BAD_REQUEST', 'Invalid webhook', 400);
    }
    const users = [...new Set((arrays as string[][]).flat().filter(uuid))];
    if (!users.length) return json({ ok: true });
    try {
      changes = await Promise.all(users.map((user) => snapshot(user, deps)));
    } catch {
      return error('INTERNAL_ERROR', 'Webhook processing failed', 500);
    }
  } else {
    if (!uuid(event.app_user_id) || !Array.isArray(event.entitlement_ids)) {
      return error('BAD_REQUEST', 'Invalid webhook', 400);
    }
    if (!event.entitlement_ids.includes('premium')) return json({ ok: true });
    try {
      changes = [await snapshot(event.app_user_id, deps)];
    } catch {
      return error('INTERNAL_ERROR', 'Webhook processing failed', 500);
    }
  }
  try {
    const { error: dbError } = await (deps.admin ?? createAdminClient()).rpc(
      'apply_revenuecat_event',
      {
        p_event_id: event.id,
        p_occurred_at: new Date(event.event_timestamp_ms).toISOString(),
        p_changes: changes,
      },
    );
    if (dbError) throw new Error('DATABASE_FAILED');
    return json({ ok: true });
  } catch {
    return error('INTERNAL_ERROR', 'Webhook processing failed', 500);
  }
};
if (import.meta.main) Deno.serve((request) => handle(request));
