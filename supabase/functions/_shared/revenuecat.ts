// Canonical RevenueCat state (BE-18, BE-48). Entitlements are written only from this snapshot of
// the fixed RevenueCat REST host, never from webhook fields or anything the app sends.

export type Change = {
  user_id: string;
  is_active: boolean;
  product_id: string | null;
  store: string | null;
  expires_at: string | null;
  // BE-48: store-trial metadata for the day-5 `trial_ending` reminder (private in the database).
  period_type: 'normal' | 'trial' | 'intro' | 'prepaid' | null;
  period_started_at: string | null;
  will_renew: boolean;
};
export type SnapshotDeps = {
  fetch?: typeof fetch;
  getEnv?: (name: string) => string | undefined;
  now?: () => Date;
};

export const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export const anonymous = (v: unknown): boolean =>
  typeof v === 'string' && v.startsWith('$RCAnonymousID:');
export const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const date = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error('INVALID_SNAPSHOT');
  return new Date(v).toISOString();
};
// Optional trial metadata never blocks the entitlement write: malformed values become null.
const optionalDate = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const periods = new Set(['normal', 'trial', 'intro', 'prepaid']);

// Refresh the canonical premium entitlement. An expiration for one product must not revoke
// another active product; TRANSFER has no product/expiry. After `Purchases.logIn(uid)` the
// subscriber `uid` includes purchases made under its aliased anonymous id.
export const snapshot = async (user: string, deps: SnapshotDeps): Promise<Change> => {
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
    return {
      user_id: user,
      is_active: false,
      product_id: null,
      store: null,
      expires_at: null,
      period_type: null,
      period_started_at: null,
      will_renew: false,
    };
  }
  if (
    typeof premium.product_identifier !== 'string' || premium.product_identifier.length < 1 ||
    premium.product_identifier.length > 200
  ) throw new Error('INVALID_SNAPSHOT');
  const expires = date(premium.expires_date);
  const purchases = object(subscriber.non_subscriptions)?.[premium.product_identifier];
  const renewing = object(object(subscriber.subscriptions)?.[premium.product_identifier]);
  const subscription = renewing ?? object(Array.isArray(purchases) ? purchases.at(-1) : null);
  // RevenueCat keeps access during store-confirmed billing grace, even after paid expiry.
  // Persist the effective end too: SQL premium checks independently enforce expires_at.
  const grace = date(
    premium.grace_period_expires_date ?? subscription?.grace_period_expires_date ?? null,
  );
  const effectiveEnd = expires !== null && grace !== null && Date.parse(grace) > Date.parse(expires)
    ? grace
    : expires;
  const period = typeof renewing?.period_type === 'string'
    ? renewing.period_type.toLowerCase()
    : null;
  return {
    user_id: user,
    is_active: effectiveEnd === null ||
      Date.parse(effectiveEnd) > (deps.now?.() ?? new Date()).getTime(),
    product_id: premium.product_identifier,
    store: typeof subscription?.store === 'string' ? subscription.store.toLowerCase() : null,
    expires_at: effectiveEnd,
    period_type: period !== null && periods.has(period) ? period as Change['period_type'] : null,
    period_started_at: renewing ? optionalDate(renewing.purchase_date) : null,
    // A cancelled trial or one with a billing issue will not convert: no reminder for it.
    will_renew: renewing !== null && renewing.unsubscribe_detected_at == null &&
      renewing.billing_issues_detected_at == null,
  };
};
