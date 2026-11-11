// BE-43 (D46, D08, D09): removes voice recordings nobody can use any more, through the Storage API.
// pg_cron calls it hourly (private.dispatch_voice_cleanup, internal secret). The database decides
// what goes (`voice_sweep`: unreferenced and older than 24 h, or the couple/uploader is gone); this
// function only deletes the listed objects. The sweep runs on the database clock (BE-43b: no p_now
// from here), the same clock as the 23-hour attach window, so a skewed function clock cannot remove
// a recording that may still be attached. Idempotent: a second run finds nothing left, and
// removing an already removed object is a no-op in Storage. Logs carry counts only, never names.
import { createAdminClient } from '../_shared/admin.ts';
import { requireInternalSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { objectNames, removeVoiceObjects } from '../_shared/voice.ts';

type SweepResult = { data: unknown; error: unknown | null };
type RemoveResult = { error: unknown | null };
export type CleanupAdmin = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<SweepResult>;
  storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<RemoveResult> } };
};
type Deps = { admin?: CleanupAdmin };

export const BATCH = 500; // names per sweep call
const MAX_ROUNDS = 10; // at most 5,000 objects per run; the next hourly run continues

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<boolean> = requireInternalSecret,
  deps: Deps = {},
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  const admin = deps.admin ?? (createAdminClient() as unknown as CleanupAdmin);
  let removed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { data, error: sweepError } = await admin.rpc('voice_sweep', { p_limit: BATCH });
    if (sweepError) {
      log('voice_cleanup.sweep_failed', { removed });
      return error('INTERNAL_ERROR', 'Voice cleanup failed', 500);
    }
    const names = objectNames(data);
    if (names.length === 0) break;
    if (!await removeVoiceObjects(admin, names)) {
      log('voice_cleanup.remove_failed', { removed });
      return error('INTERNAL_ERROR', 'Voice cleanup failed', 500);
    }
    removed += names.length;
    if (names.length < BATCH) break;
  }
  log('voice_cleanup.completed', { removed });
  return json({ removed });
};

if (import.meta.main) Deno.serve((request) => handle(request));
