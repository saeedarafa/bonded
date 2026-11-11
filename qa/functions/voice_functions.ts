// QA-27: runs the real `delete-account` or `voice-cleanup` Edge Function handler once against the
// local Supabase stack and prints `{"status":n,"body":...}` on stdout. Used by
// qa/contract/voice.test.ts (BE-43: objects removed by delete-account and by the cleanup after the
// D08 purge). Authentication is the real one: the bearer comes from VOICE_BEARER (none when empty):
// delete-account checks it as a user JWT through Supabase Auth, voice-cleanup against
// INTERNAL_FUNCTION_SECRET (a made-up FIXTURE value the test passes in the env). The admin client
// is the real service-role client from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
//   deno run --allow-net --allow-env --allow-read --config supabase/functions/deno.json \
//     qa/functions/voice_functions.ts delete-account|voice-cleanup
// Local stacks only: refuses a non-local SUPABASE_URL.
import { handle as deleteAccount } from '../../supabase/functions/delete-account/index.ts';
import { handle as voiceCleanup } from '../../supabase/functions/voice-cleanup/index.ts';

const LOCAL = ['127.0.0.1', 'localhost', '[::1]', '::1'];

export const run = async (which: string, token: string | undefined): Promise<Response> => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  if (!LOCAL.includes(new URL(url).hostname)) throw new Error(`not a local stack: ${url}`);
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const request = new Request(`http://local/functions/v1/${which}`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (which === 'delete-account') return await deleteAccount(request);
  if (which === 'voice-cleanup') return await voiceCleanup(request);
  throw new Error(`unknown function ${which}`);
};

if (import.meta.main) {
  const which = Deno.args[0] ?? '';
  const res = await run(which, Deno.env.get('VOICE_BEARER') || undefined);
  console.log(JSON.stringify({ status: res.status, body: await res.json() }));
}
