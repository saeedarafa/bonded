import { AuthUnavailableError, requireUser } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/admin.ts';
import { error, json } from '../_shared/http.ts';
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

const alreadyDeleted = (result: DeleteUserResult): boolean =>
  result.error?.status === 404 || result.error?.code === 'USER_NOT_FOUND';

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<string | null> = requireUser,
  getAdmin: () => AdminClient = createAdminClient,
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

  try {
    const admin = getAdmin();
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

    const result = await admin.auth.admin.deleteUser(userId);
    if (result.error && !alreadyDeleted(result)) {
      return error('DELETE_FAILED', 'Could not delete account', 500);
    }
  } catch {
    return error('DELETE_FAILED', 'Could not delete account', 500);
  }

  // The profile-delete trigger archives any active couple before the Auth cascade removes this
  // user's profile and content. A not-found response is a successful retry.
  return json({ ok: true });
};

if (import.meta.main) Deno.serve((request) => handle(request));
