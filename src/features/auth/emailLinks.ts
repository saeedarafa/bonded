/** The native scheme is registered in app.config.ts; allow this exact redirect in Supabase Auth. */
export const EMAIL_AUTH_REDIRECT = 'bonded://auth/callback';

export type EmailAuthCallback =
  | { kind: 'pkce'; code: string }
  | { kind: 'implicit'; access_token: string; refresh_token: string }
  | { kind: 'invalid' };

/**
 * Never return server error_description text (it is untrusted and may contain secrets).
 * Root callbacks support older emails whose Site URL was just bonded://.
 */
export function parseEmailAuthCallback(raw: string): EmailAuthCallback | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'bonded:' || url.username || url.password || url.port) return null;
  const path = `${url.hostname}${url.pathname}`.replace(/^\/|\/$/g, '');
  if (path !== 'auth/callback' && path !== '') return null;

  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.slice(1));
  // Reject ambiguous credentials rather than choosing between query and fragment values.
  for (const [key, value] of fragment) params.append(key, value);
  const keys = [
    'code',
    'access_token',
    'refresh_token',
    'error',
    'error_code',
    'error_description',
  ];
  if (path === '' && !keys.some((key) => params.has(key))) return null;
  if (keys.some((key) => params.getAll(key).length > 1)) return { kind: 'invalid' };
  if (['error', 'error_code', 'error_description'].some((key) => params.has(key))) {
    return { kind: 'invalid' };
  }
  const code = params.get('code');
  const access = params.get('access_token');
  const refresh = params.get('refresh_token');
  if (code?.trim() && !params.has('access_token') && !params.has('refresh_token')) {
    return { kind: 'pkce', code };
  }
  if (access?.trim() && refresh?.trim() && !params.has('code')) {
    return { kind: 'implicit', access_token: access, refresh_token: refresh };
  }
  return { kind: 'invalid' };
}
