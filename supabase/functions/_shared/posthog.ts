// BE-51 (D54, ANALYTICS.md rule 7): delete a user's PostHog person and their events.
// The PostHog distinct id is the Supabase user uuid (the app calls `identify(uid)`).
// API: POST {host}/api/projects/{project_id}/persons/bulk_delete/ with
// {distinct_ids: [uid], delete_events: true}, authenticated with a personal API key
// (scope person:write). PostHog removes the events asynchronously. Deleting an unknown distinct id
// is not an error, so the call is idempotent. A 404 is NOT success: it most likely means a wrong
// project id, host or path, so the queue row stays and backs off instead of being dropped (SEC-16).
// Redirects are refused so the key never follows one.
// Never log the uuid, the key or the response body: callers log only status and attempt counts.

type GetEnv = (name: string) => string | undefined;

export const DEFAULT_POSTHOG_API_HOST = 'https://eu.posthog.com';
// PostHog Cloud private API hosts. Anything else is refused so a typo cannot send the key elsewhere.
const ALLOWED_POSTHOG_HOSTS = new Set(['eu.posthog.com', 'us.posthog.com']);

export type PostHogConfig = { host: string; projectId: string; apiKey: string };
export type PostHogSetup =
  | { config: PostHogConfig; skip?: undefined }
  | { config?: undefined; skip: 'not_configured' | 'misconfigured' };

// POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are required; POSTHOG_API_HOST defaults to the
// EU private API host. A host other than https://eu.posthog.com or https://us.posthog.com, or a
// non-numeric project id, is refused, so the key is never sent somewhere unexpected.
export const posthogSetup = (getEnv: GetEnv = (name) => Deno.env.get(name)): PostHogSetup => {
  const apiKey = getEnv('POSTHOG_PERSONAL_API_KEY')?.trim();
  const projectId = getEnv('POSTHOG_PROJECT_ID')?.trim();
  if (!apiKey || !projectId) return { skip: 'not_configured' };
  const rawHost = getEnv('POSTHOG_API_HOST')?.trim() || DEFAULT_POSTHOG_API_HOST;
  let host: URL;
  try {
    host = new URL(rawHost);
  } catch {
    return { skip: 'misconfigured' };
  }
  if (
    host.protocol !== 'https:' || host.port !== '' || !ALLOWED_POSTHOG_HOSTS.has(host.hostname) ||
    !/^\d+$/.test(projectId)
  ) {
    return { skip: 'misconfigured' };
  }
  return { config: { host: host.origin, projectId, apiKey } };
};

export type DeleteDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number[];
};
export type DeleteOutcome = { ok: boolean; status: number; attempts: number };

// 0 = network error, timeout or refused redirect. 429 and 5xx are worth retrying; other 4xx (bad
// key, wrong project, 404) are not, until someone fixes the configuration: the row stays queued.
const retryable = (status: number): boolean => status === 0 || status === 429 || status >= 500;
const succeeded = (status: number): boolean => status >= 200 && status < 300;

export const deletePostHogPerson = async (
  config: PostHogConfig,
  distinctId: string,
  deps: DeleteDeps = {},
): Promise<DeleteOutcome> => {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = Math.max(1, deps.attempts ?? 3);
  const backoff = deps.backoffMs ?? [250, 1000];
  const url = `${config.host}/api/projects/${config.projectId}/persons/bulk_delete/`;
  let status = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ distinct_ids: [distinctId], delete_events: true }),
        redirect: 'error',
        signal: AbortSignal.timeout(deps.timeoutMs ?? 3000),
      });
      status = response.status;
      await response.body?.cancel();
    } catch {
      status = 0;
    }
    if (succeeded(status)) return { ok: true, status, attempts: attempt };
    if (!retryable(status) || attempt === maxAttempts) {
      return { ok: false, status, attempts: attempt };
    }
    await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
  }
  return { ok: false, status, attempts: maxAttempts };
};
