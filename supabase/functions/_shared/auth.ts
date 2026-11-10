import { createAdminClient } from './admin.ts';

type GetEnv = (name: string) => string | undefined;
type GetUser = (token: string) => Promise<string | null>;

const bearer = (request: Request): string | null => {
  const value = request.headers.get('authorization');
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

// Hash before comparing so an invalid caller cannot learn a matching-prefix length.
const equal = async (left: string, right: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
};

export const requireSecret = async (
  request: Request,
  secretName: string,
  getEnv: GetEnv = Deno.env.get,
): Promise<boolean> => {
  const expected = getEnv(secretName);
  const supplied = bearer(request);
  return Boolean(expected && supplied && await equal(supplied, expected));
};

export const requireInternalSecret = (request: Request, getEnv?: GetEnv): Promise<boolean> =>
  requireSecret(request, 'INTERNAL_FUNCTION_SECRET', getEnv);

export const requireRevenueCatSecret = (request: Request, getEnv?: GetEnv): Promise<boolean> =>
  requireSecret(request, 'REVENUECAT_WEBHOOK_SECRET', getEnv);

// Supabase Auth could not answer (network failure, timeout or a 5xx). Callers map this to
// 503 AUTH_UNAVAILABLE so a client retries instead of treating a working session as signed out.
export class AuthUnavailableError extends Error {
  constructor() {
    super('Auth unavailable');
    this.name = 'AuthUnavailableError';
  }
}

// Only a 4xx from Auth (bad, expired or revoked JWT; unknown user) means "not authenticated".
// Anything else (status 0 for fetch failures, 5xx, no status) means Auth is unreachable.
export const isInvalidCredential = (status: unknown): boolean =>
  typeof status === 'number' && status >= 400 && status < 500;

export const getUserFromSupabase: GetUser = async (token) => {
  // A missing configuration fails closed as before (401), it is not an Auth outage.
  const client = createAdminClient();
  const { data, error: authError } = await client.auth.getUser(token);
  if (authError) {
    if (isInvalidCredential((authError as { status?: unknown }).status)) return null;
    throw new AuthUnavailableError();
  }
  return data.user?.id ?? null;
};

// Returns the caller's user id, or null for a missing or rejected token (401). Rethrows
// AuthUnavailableError (503); any other failure stays fail-closed as null (401).
export const requireUser = async (
  request: Request,
  getUser: GetUser = getUserFromSupabase,
): Promise<string | null> => {
  const token = bearer(request);
  if (!token) return null;
  try {
    return await getUser(token);
  } catch (cause) {
    if (cause instanceof AuthUnavailableError) throw cause;
    return null;
  }
};
