import { requireUser } from '../_shared/auth.ts';
import { createAdminClient } from '../_shared/admin.ts';
import { error, json } from '../_shared/http.ts';

type DeleteUserResult = { error: { code?: string; status?: number } | null };
type AdminClient = {
  auth: { admin: { deleteUser: (userId: string) => Promise<DeleteUserResult> } };
};

const alreadyDeleted = (result: DeleteUserResult): boolean =>
  result.error?.status === 404 || result.error?.code === 'USER_NOT_FOUND';

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<string | null> = requireUser,
  getAdmin: () => AdminClient = createAdminClient,
): Promise<Response> => {
  const userId = await authenticate(request);
  if (!userId) return error('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const result = await getAdmin().auth.admin.deleteUser(userId);
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
