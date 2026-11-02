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

const getUserFromSupabase: GetUser = async (token) => {
  const { data, error: authError } = await createAdminClient().auth.getUser(token);
  return authError || !data.user ? null : data.user.id;
};

export const requireUser = async (
  request: Request,
  getUser: GetUser = getUserFromSupabase,
): Promise<string | null> => {
  const token = bearer(request);
  if (!token) return null;
  try {
    return await getUser(token);
  } catch {
    return null;
  }
};
