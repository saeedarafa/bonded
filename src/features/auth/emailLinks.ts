/** The native scheme is registered in app.config.ts; allow this exact redirect in Supabase Auth. */
export const EMAIL_AUTH_REDIRECT = 'bonded://auth/callback';

export type EmailAuthCallback = { kind: 'pkce'; code: string } | { kind: 'invalid' };

/**
 * Never return server error_description text (it is untrusted and may contain secrets).
 * Only PKCE codes are accepted. Root PKCE callbacks support emails whose Site URL was bonded://.
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
  // Never import a session from a URL, even with a code present or an empty token value.
  // Check decoded parameter names in both locations, including provider/ID/token-hash variants.
  const hasTokens = Array.from(params.keys()).some((key) => /token/i.test(key));
  const keys = ['code', 'error', 'error_code', 'error_description'];
  if (path === '' && !hasTokens && !keys.some((key) => params.has(key))) return null;
  if (hasTokens) return { kind: 'invalid' };
  if (keys.some((key) => params.getAll(key).length > 1)) return { kind: 'invalid' };
  if (['error', 'error_code', 'error_description'].some((key) => params.has(key))) {
    return { kind: 'invalid' };
  }
  const code = params.get('code');
  if (code?.trim()) {
    return { kind: 'pkce', code };
  }
  return { kind: 'invalid' };
}
