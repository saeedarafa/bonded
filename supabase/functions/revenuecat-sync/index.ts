// BE-48 (D50): after sign-in the app calls `Purchases.logIn(uid)`, which aliases a purchase made
// on P3 under the anonymous RevenueCat id. RevenueCat sends no webhook for that alias, so the app
// then asks this function to refresh ITS OWN entitlement. The request carries nothing but the
// user's JWT: the state comes from RevenueCat's REST API (same snapshot as the webhook) and is
// written through apply_revenuecat_event. One lookup per user per 30 s and at most 120 lookups
// per minute overall (BE-48b, protects the shared RevenueCat API quota); both answer 429.
import { createAdminClient } from '../_shared/admin.ts';
import { AuthUnavailableError, requireUser } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { renewing, snapshot, type SnapshotDeps } from '../_shared/revenuecat.ts';

type Deps = SnapshotDeps & { admin?: Pick<ReturnType<typeof createAdminClient>, 'rpc'> };

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<string | null> = requireUser,
  deps: Deps = {},
): Promise<Response> => {
  if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 'Use POST', 405);
  let userId: string | null;
  try {
    userId = await authenticate(request);
  } catch (cause) {
    if (cause instanceof AuthUnavailableError) {
      return error('AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable', 503);
    }
    return error('UNAUTHORIZED', 'Unauthorized', 401);
  }
  if (!userId) return error('UNAUTHORIZED', 'Unauthorized', 401);
  try {
    const admin = deps.admin ?? createAdminClient();
    const now = deps.now?.() ?? new Date();
    const { data: allowed, error: limitError } = await admin.rpc('claim_revenuecat_sync', {
      p_user: userId,
      p_now: now.toISOString(),
    });
    if (limitError) throw new Error('DATABASE_FAILED');
    if (allowed !== true) return error('RATE_LIMITED', 'Try again shortly', 429);
    const change = await snapshot(userId, { ...deps, now: () => now });
    // A per-call event id: the ledger dedupes nothing here, the timestamp orders it against
    // webhooks (an older webhook delivered later is ignored; its state is already included).
    const { error: dbError } = await admin.rpc('apply_revenuecat_event', {
      p_event_id: `sync:${userId}:${now.getTime()}`,
      p_occurred_at: now.toISOString(),
      p_changes: [change],
    });
    if (dbError) throw new Error('DATABASE_FAILED');
    // BE-63: a refresh that shows the plan renewing again drops a pending `cancel_offer` push,
    // same rule as the webhook (own uid only; idempotent).
    if (renewing(change)) {
      const { error: queueError } = await admin.rpc('queue_cancel_offer', {
        p_user: userId,
        p_cancelled: false,
        p_now: now.toISOString(),
      });
      if (queueError) throw new Error('DATABASE_FAILED');
    }
    log('revenuecat.synced', { active: change.is_active });
    return json({ ok: true, is_active: change.is_active });
  } catch {
    log('revenuecat.sync_failed');
    return error('SYNC_FAILED', 'Could not refresh the subscription', 500);
  }
};
if (import.meta.main) Deno.serve((request) => handle(request));
