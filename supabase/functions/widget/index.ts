// BE-60 (D59, SEC-21 option A): the Premium widgets' only server path.
//
// The caller is a widget, Lock Screen accessory, Control (iOS App Intent) or an Android widget
// receiver. It holds an opaque, short-lived widget token (`bwt_…`, minted by the app with
// `mint_widget_token`), never the user's session. The token is read only from
// `Authorization: Bearer`, hashed here, and the hash goes to ONE service-only RPC per action.
// Each RPC checks the token itself (`private.widget_auth`), so this function cannot skip it.
//
// Never logged: the token, its hash, the Authorization header, the request body, question text.
import { createAdminClient } from '../_shared/admin.ts';
import { error, json } from '../_shared/http.ts';

type RpcError = { message?: string; details?: string | null };
type RpcResult = { data: unknown; error: RpcError | null };
export type Dependencies = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

const production: Dependencies = {
  async rpc(name, args) {
    const { data, error: failure } = await createAdminClient().rpc(name, args);
    return { data, error: failure ? { message: failure.message, details: failure.details } : null };
  },
};

const TOKEN = /^bwt_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you']);

// Codes the widget RPCs raise, and their HTTP status. Anything else is WIDGET_FAILED (500).
const STATUS: Record<string, number> = {
  WIDGET_AUTH: 401,
  PREMIUM_REQUIRED: 403,
  INVALID_LITTLE_THING: 400,
  LITTLE_THING_LIMIT: 409,
  UNDO_EXPIRED: 409,
  RATE_LIMITED: 429,
};
const MESSAGE: Record<string, string> = {
  WIDGET_AUTH: 'Open Bonded to continue',
  PREMIUM_REQUIRED: 'Premium required',
  INVALID_LITTLE_THING: 'Invalid request',
  LITTLE_THING_LIMIT: 'Limit reached for today',
  UNDO_EXPIRED: 'Too late to undo',
  RATE_LIMITED: 'Try again shortly',
};

// A bearer capability and per-user data: never cache, never leak a referrer.
const uncached = (response: Response): Response => {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');
  return response;
};

export const hashToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

const unauthorized = () => uncached(error('WIDGET_AUTH', MESSAGE.WIDGET_AUTH, 401));

const readBody = async (request: Request): Promise<unknown> => {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let body = '';
  let bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 1024) {
      await reader.cancel();
      throw new Error('TOO_LARGE');
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body.trim() === '' ? {} : JSON.parse(body);
};

const fromRpc = (failure: RpcError): Response => {
  const code = failure.message ?? '';
  const status = STATUS[code];
  if (!status) return uncached(error('WIDGET_FAILED', 'Widget unavailable', 500));
  if (code === 'LITTLE_THING_LIMIT') {
    // Only the two allow-listed detail fields go out.
    let kind: string | null = null;
    let more = false;
    try {
      const detail = JSON.parse(failure.details ?? '{}');
      if (KINDS.has(detail.kind)) kind = detail.kind;
      more = detail.more_with_premium === true;
    } catch { /* keep the defaults */ }
    return uncached(
      json({ error: code, message: MESSAGE[code], kind, more_with_premium: more }, status),
    );
  }
  return uncached(error(code, MESSAGE[code], status));
};

export const createHandler = (deps: Dependencies = production) => async (request: Request) => {
  if (request.method !== 'POST') {
    const response = error('METHOD_NOT_ALLOWED', 'Use POST', 405);
    response.headers.set('allow', 'POST');
    return uncached(response);
  }
  // The token only from the Authorization header (never a URL or the body).
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match || !TOKEN.test(match[1])) return unauthorized();
  try {
    let input: Record<string, unknown>;
    try {
      const parsed = await readBody(request);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return uncached(error('INVALID_REQUEST', 'Invalid request', 400));
      }
      input = parsed as Record<string, unknown>;
    } catch {
      return uncached(error('INVALID_REQUEST', 'Invalid request', 400));
    }
    const hash = await hashToken(match[1]);
    let result: RpcResult;
    switch (input.action) {
      case 'state':
        result = await deps.rpc('widget_state', { p_token_hash: hash });
        break;
      case 'send':
        if (
          typeof input.kind !== 'string' || !KINDS.has(input.kind) ||
          typeof input.client_id !== 'string' || !UUID.test(input.client_id)
        ) return uncached(error('INVALID_REQUEST', 'Invalid request', 400));
        result = await deps.rpc('widget_send', {
          p_token_hash: hash,
          p_kind: input.kind,
          p_client_id: input.client_id,
        });
        break;
      case 'undo':
        if (typeof input.id !== 'string' || !UUID.test(input.id)) {
          return uncached(error('INVALID_REQUEST', 'Invalid request', 400));
        }
        result = await deps.rpc('widget_undo', { p_token_hash: hash, p_id: input.id });
        break;
      default:
        return uncached(error('INVALID_REQUEST', 'Invalid request', 400));
    }
    if (result.error) return fromRpc(result.error);
    // The RPCs build their JSON field by field (allow-listed in SQL); passed through as is.
    return uncached(json(input.action === 'undo' ? { little_things: result.data } : result.data));
  } catch {
    return uncached(error('WIDGET_FAILED', 'Widget unavailable', 500));
  }
};

if (import.meta.main) Deno.serve(createHandler());
