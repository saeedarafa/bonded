import { requireUser } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<string | null> = requireUser,
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  // BE-16 deletes the authenticated user through the admin client and remains idempotent.
  return json({ ok: true });
};

if (import.meta.main) Deno.serve((request) => handle(request));
