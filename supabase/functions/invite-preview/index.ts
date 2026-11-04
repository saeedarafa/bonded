import { createAdminClient } from '../_shared/admin.ts';
import { error, json } from '../_shared/http.ts';

type Preview = {
  inviter_name: string;
  inviter_avatar_url: null;
  inviter_answered_today: boolean;
  expires_at: string;
};
type LinkPreview = { preview: Preview; avatar_path: string | null };
type Dependencies = {
  preview: (code: string, token: string) => Promise<LinkPreview | null>;
  sign: (path: string, seconds: number) => Promise<string | null>;
  now: () => number;
};
const production: Dependencies = {
  async preview(code, token) {
    const { data, error: failure } = await createAdminClient().rpc('invite_preview_for_link', {
      p_code: code,
      p_token: token,
    });
    if (failure) throw new Error('PREVIEW_FAILED');
    return data as LinkPreview | null;
  },
  async sign(path, seconds) {
    const { data, error: failure } = await createAdminClient().storage.from('avatars')
      .createSignedUrl(path, seconds);
    return failure ? null : data?.signedUrl ?? null;
  },
  now: Date.now,
};

// Never cache a bearer capability or a signed URL, including error responses.
const uncached = (response: Response): Response => {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');
  return response;
};

export const createHandler = (deps: Dependencies = production) => async (request: Request) => {
  if (request.method !== 'POST') {
    const response = error('METHOD_NOT_ALLOWED', 'Use POST', 405);
    response.headers.set('allow', 'POST');
    return uncached(response);
  }
  try {
    // Bound the body while reading, rather than trusting Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return uncached(error('INVALID_REQUEST', 'Invalid request', 400));
    let body = '';
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024) {
        await reader.cancel();
        return uncached(error('INVALID_REQUEST', 'Request too large', 413));
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return uncached(error('INVALID_REQUEST', 'Invalid request', 400));
    }
    if (
      !input || typeof input.p_code !== 'string' || input.p_code.length > 32 ||
      typeof input.p_token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(input.p_token)
    ) return uncached(error('UNAUTHORIZED', 'Invalid invite link', 401));

    const result = await deps.preview(input.p_code, input.p_token);
    if (!result) return uncached(error('UNAUTHORIZED', 'Invalid invite link', 401));
    const seconds = Math.min(
      60,
      Math.floor((Date.parse(result.preview.expires_at) - deps.now()) / 1000),
    );
    if (!Number.isFinite(seconds) || seconds < 1) {
      return uncached(error('UNAUTHORIZED', 'Invalid invite link', 401));
    }
    let url: string | null = null;
    if (result.avatar_path) {
      if (!/^[0-9a-f-]{36}\/avatar\.jpg$/.test(result.avatar_path)) {
        throw new Error('PREVIEW_FAILED');
      }
      // Missing/deleted avatars and Storage outages keep the normal initial fallback.
      try {
        url = await deps.sign(result.avatar_path, seconds);
      } catch {
        url = null;
      }
    }
    // Whitelist the outward fields: the canonical object path is service-only.
    return uncached(json({
      inviter_name: result.preview.inviter_name,
      inviter_avatar_url: url,
      inviter_answered_today: result.preview.inviter_answered_today,
      expires_at: result.preview.expires_at,
    }));
  } catch {
    // No tokens, signed URLs, profile data, or upstream error text in logs/responses.
    return uncached(error('PREVIEW_FAILED', 'Preview unavailable', 500));
  }
};

if (import.meta.main) Deno.serve(createHandler());
