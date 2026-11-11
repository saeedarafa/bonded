import { AuthUnavailableError, requireUser } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/admin.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { type DeleteDeps, deletePostHogPerson, posthogSetup } from '../_shared/posthog.ts';
import { objectNames, removeVoiceObjects } from '../_shared/voice.ts';

type DeleteUserResult = { error: { code?: string; status?: number } | null };
type RemoveAvatarResult = { error: unknown | null };
type AdminClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<
    { data: unknown; error: unknown | null }
  >;
  auth: { admin: { deleteUser: (userId: string) => Promise<DeleteUserResult> } };
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<RemoveAvatarResult>;
    };
  };
};

export type AnalyticsDeps = DeleteDeps & { getEnv?: (name: string) => string | undefined };

const alreadyDeleted = (result: DeleteUserResult): boolean =>
  result.error?.status === 404 || result.error?.code === 'USER_NOT_FOUND';

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<string | null> = requireUser,
  getAdmin: () => AdminClient = createAdminClient,
  analytics: AnalyticsDeps = {},
): Promise<Response> => {
  let userId: string | null;
  try {
    userId = await authenticate(request);
  } catch (cause) {
    if (cause instanceof AuthUnavailableError) {
      return error('AUTH_UNAVAILABLE', 'Authentication is temporarily unavailable', 503);
    }
    return error('DELETE_FAILED', 'Could not delete account', 500);
  }
  if (!userId) return error('UNAUTHORIZED', 'Unauthorized', 401);

  let admin: AdminClient;
  try {
    admin = getAdmin();
    const avatar = await admin.storage.from('avatars').remove([`${userId}/avatar.jpg`]);
    if (avatar.error) return error('DELETE_FAILED', 'Could not delete account', 500);

    // BE-43 (D09): every voice recording the user uploaded, in any couple. Removed before the Auth
    // user so a failure keeps the account and the app can retry; the hourly voice-cleanup sweep
    // is the backstop for anything uploaded in between.
    const voice = await admin.rpc('voice_objects_of_user', { p_user: userId });
    if (voice.error) return error('DELETE_FAILED', 'Could not delete account', 500);
    if (!await removeVoiceObjects(admin, objectNames(voice.data))) {
      return error('DELETE_FAILED', 'Could not delete account', 500);
    }

    // BE-51 (D54): record the PostHog deletion before the Auth user goes, so it survives a crash
    // right after. Never blocks: a failure here is logged and the inline attempt below still runs.
    try {
      const recorded = await admin.rpc('analytics_deletion_request', { p_user: userId });
      if (recorded.error) log('delete_account.analytics_request_failed');
    } catch {
      log('delete_account.analytics_request_failed');
    }

    const result = await admin.auth.admin.deleteUser(userId);
    if (result.error && !alreadyDeleted(result)) {
      return error('DELETE_FAILED', 'Could not delete account', 500);
    }
  } catch {
    return error('DELETE_FAILED', 'Could not delete account', 500);
  }

  await deleteAnalytics(admin, userId, analytics);

  // The profile-delete trigger archives any active couple before the Auth cascade removes this
  // user's profile and content. A not-found response is a successful retry.
  return json({ ok: true });
};

// BE-51: delete the PostHog person and events after the account is gone. Every outcome is
// swallowed: the account deletion has already succeeded. Success clears the queue row; a failure
// reschedules it for the hourly `analytics-deletions` run; without secrets the row simply waits.
// Logs carry the outcome, HTTP status and attempt count only (no uuid, no key).
const deleteAnalytics = async (
  admin: AdminClient,
  userId: string,
  deps: AnalyticsDeps,
): Promise<void> => {
  try {
    const setup = posthogSetup(deps.getEnv);
    if (!setup.config) {
      log('delete_account.analytics_skipped', { reason: setup.skip });
      return;
    }
    const outcome = await deletePostHogPerson(setup.config, userId, deps);
    log(outcome.ok ? 'delete_account.analytics_deleted' : 'delete_account.analytics_failed', {
      status: outcome.status,
      attempts: outcome.attempts,
    });
    const report = await admin.rpc('analytics_deletion_result', {
      p_user: userId,
      p_ok: outcome.ok,
      p_status: outcome.status,
    });
    if (report.error) log('delete_account.analytics_report_failed');
  } catch {
    log('delete_account.analytics_failed', { status: -1 });
  }
};

if (import.meta.main) Deno.serve((request) => handle(request));
