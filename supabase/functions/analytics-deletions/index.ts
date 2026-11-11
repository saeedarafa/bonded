// BE-51 (D54): retries PostHog person + event deletions that `delete-account` could not finish.
// pg_cron calls it hourly (private.dispatch_analytics_deletions, internal secret), only when a row is
// due. The database hands out due rows whose Auth user is already gone (`analytics_deletions_due`,
// leased for 10 minutes) and records each outcome (`analytics_deletion_result`: success removes the
// row, failure backs off up to 24 h). Without PostHog secrets nothing is claimed and the rows wait.
// Idempotent: deleting an unknown distinct id in PostHog is not an error. Logs carry counts only.
import { createAdminClient } from '../_shared/admin.ts';
import { requireInternalSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { type DeleteDeps, deletePostHogPerson, posthogSetup } from '../_shared/posthog.ts';

type RpcResult = { data: unknown; error: unknown | null };
export type AnalyticsAdmin = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};
type Deps = DeleteDeps & {
  admin?: AnalyticsAdmin;
  getEnv?: (name: string) => string | undefined;
};

export const BATCH = 50;
const MAX_ROUNDS = 4; // at most 200 people per run; the next hourly run continues

const uuids = (data: unknown): string[] =>
  Array.isArray(data)
    ? data
      .map((row) => (typeof row === 'string'
        ? row
        : (row as Record<string, unknown>)?.analytics_deletions_due)
      )
      .filter((id): id is string =>
        typeof id === 'string'
      )
    : [];

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<boolean> = requireInternalSecret,
  deps: Deps = {},
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  const setup = posthogSetup(deps.getEnv);
  if (!setup.config) {
    log('analytics_deletions.skipped', { reason: setup.skip });
    return json({ deleted: 0, failed: 0, skipped: setup.skip });
  }
  const admin = deps.admin ?? (createAdminClient() as unknown as AnalyticsAdmin);
  let deleted = 0;
  let failed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const due = await admin.rpc('analytics_deletions_due', { p_limit: BATCH });
    if (due.error) {
      log('analytics_deletions.claim_failed', { deleted, failed });
      return error('INTERNAL_ERROR', 'Analytics deletion failed', 500);
    }
    const ids = uuids(due.data);
    for (const id of ids) {
      const outcome = await deletePostHogPerson(setup.config, id, { attempts: 2, ...deps });
      if (outcome.ok) deleted++;
      else failed++;
      const report = await admin.rpc('analytics_deletion_result', {
        p_user: id,
        p_ok: outcome.ok,
        p_status: outcome.status,
      });
      if (report.error) log('analytics_deletions.report_failed');
    }
    if (ids.length < BATCH) break;
  }
  log('analytics_deletions.completed', { deleted, failed });
  return json({ deleted, failed });
};

if (import.meta.main) Deno.serve((request) => handle(request));
