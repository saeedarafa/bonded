// QA-28: runs the real `notify` Edge Function handler once with the BE-45 event
// `{"type":"little_thing"}` against the local Supabase stack and prints
// `{"status":n,"body":...,"messages":[...]}` on stdout. Used by qa/contract/little-things.test.ts.
// The claim (claim_little_thing_pushes, database clock), the push_tokens lookup and the push_log
// updates are the real ones through the service-role client from SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY; only the Expo transport is replaced by a recorder, so nothing leaves
// the machine. Authentication is the real INTERNAL_FUNCTION_SECRET check: the bearer comes from
// NOTIFY_BEARER (none when empty); the test passes a FIXTURE secret in the env.
// NOTIFY_INVALID lists tokens (comma separated) the fake transport reports as DeviceNotRegistered.
// NOTIFY_SEND_FAIL=1 makes the fake transport throw (delivery failure).
//   deno run --allow-net --allow-env --allow-read --config supabase/functions/deno.json \
//     qa/functions/notify_little_things.ts
// Local stacks only: refuses a non-local SUPABASE_URL.
import { handle } from '../../supabase/functions/notify/index.ts';
import type { ExpoMessage, PushResult } from '../../supabase/functions/_shared/push.ts';

const LOCAL = ['127.0.0.1', 'localhost', '[::1]', '::1'];

export const run = async (
  token: string | undefined,
  body: unknown = { type: 'little_thing' },
  invalid: string[] = [],
  fail = false,
): Promise<{ response: Response; messages: ExpoMessage[] }> => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  if (!LOCAL.includes(new URL(url).hostname)) throw new Error(`not a local stack: ${url}`);
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const request = new Request('http://local/functions/v1/notify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const messages: ExpoMessage[] = [];
  const send = (batch: ExpoMessage[]): Promise<PushResult> => {
    if (fail) return Promise.reject(new Error('FIXTURE transport down'));
    messages.push(...batch);
    return Promise.resolve({
      tickets: batch.map((m) =>
        invalid.includes(m.to)
          ? { status: 'error' as const, details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok' as const }
      ),
      invalidTokens: batch.map((m) => m.to).filter((t) => invalid.includes(t)),
    });
  };
  const response = await handle(request, undefined, { send });
  return { response, messages };
};

if (import.meta.main) {
  const invalid = (Deno.env.get('NOTIFY_INVALID') ?? '').split(',').filter(Boolean);
  const raw = Deno.env.get('NOTIFY_BODY');
  const { response, messages } = await run(
    Deno.env.get('NOTIFY_BEARER') || undefined,
    raw ? JSON.parse(raw) : undefined,
    invalid,
    Deno.env.get('NOTIFY_SEND_FAIL') === '1',
  );
  console.log(JSON.stringify({ status: response.status, body: await response.json(), messages }));
}
