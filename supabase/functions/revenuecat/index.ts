import { requireRevenueCatSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<boolean> = requireRevenueCatSecret,
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  // BE-18 validates and persists RevenueCat events idempotently.
  return json({ ok: true });
};

if (import.meta.main) Deno.serve((request) => handle(request));
