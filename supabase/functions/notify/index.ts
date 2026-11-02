import { requireInternalSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<boolean> = requireInternalSecret,
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  // BE-08 adds target selection, dedupe, quiet hours and the Expo call.
  return json({ sent: 0, suppressed: 0 });
};

if (import.meta.main) Deno.serve((request) => handle(request));
