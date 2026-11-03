// QA-11 (D35, CONTRACTS §10): the real sign-in email on the local stack.
// The app calls signInWithOtp({ emailRedirectTo: 'bonded://auth/callback' }) with flowType 'pkce'.
// Each mail must carry a 6-digit code and a link whose verify redirect lands on
// bonded://auth/callback?code=... (no token / token_hash). The code signs in with verifyOtp, and
// the link's PKCE code exchanges for a session on the initiating client.
// Reads the local Mailpit API (supabase status MAILPIT_URL, default :54324; global-setup refuses
// non-local hosts). Never logs mail text.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { PERSONAS } from './personas';

const stack = inject('stack');
const MAILPIT = stack.mailUrl;
const CALLBACK = 'bonded://auth/callback';
const NEW_USER = 'qa11-new-signin@bonded.test'; // not a persona: exercises the sign-up mail

/** A client like the app's: PKCE, in-memory storage, so the code verifier survives between calls. */
function appClient(): SupabaseClient {
  const mem = new Map<string, string>();
  return createClient(stack.url, stack.anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (k) => mem.get(k) ?? null,
        setItem: (k, v) => void mem.set(k, v),
        removeItem: (k) => void mem.delete(k),
      },
    },
  });
}
const admin = createClient(stack.url, stack.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Mail = { id: string; text: string; html: string };
const query = (to: string) => encodeURIComponent(`to:"${to}"`);

async function clearMail(to: string) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${query(to)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Mailpit not reachable at ${MAILPIT} (${res.status})`);
}

/** Newest mail to `to`, polled (the mail is sent asynchronously), never a fixed sleep. */
async function latestMail(to: string, ms = 10_000): Promise<Mail> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?limit=1&query=${query(to)}`)).json()) as {
      messages?: { ID: string }[];
    };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const m = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Text?: string;
        HTML?: string;
      };
      return { id, text: m.Text ?? '', html: m.HTML ?? '' };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no mail for ${to} within ${ms} ms`);
}

/** Same extraction as .maestro/scripts/mail-otp.js: URLs and tags removed, then a lone 6-digit run. */
function sixDigitCodes(text: string): string[] {
  const plain = text.replace(/https?:\/\/\S+/g, ' ').replace(/<[^>]*>/g, ' ');
  return [...plain.matchAll(/(?:^|\D)(\d{6})(?!\d)/g)].map((m) => m[1]);
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#43;/g, '+');
function links(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1]));
}

async function requestSignIn(email: string): Promise<{ client: SupabaseClient; mail: Mail }> {
  await clearMail(email);
  const client = appClient();
  // config.toml auth.email.max_frequency = "1s" per address (global-setup's generateLink counts too):
  // retry only that rate-limit answer, bounded, so a real send failure still fails fast.
  const until = Date.now() + 5_000;
  for (;;) {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: CALLBACK },
    });
    if (!error) break;
    if (error.code !== 'over_email_send_rate_limit' || Date.now() > until)
      throw new Error(`signInWithOtp ${email}: ${error.code ?? ''} ${error.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { client, mail: await latestMail(email) };
}

/** The verify link in the mail (points at this stack's Auth verify endpoint). */
function verifyLink(mail: Mail): URL {
  const found = links(mail.html)
    .map((h) => new URL(h))
    .filter((u) => u.origin === new URL(stack.url).origin && u.pathname === '/auth/v1/verify');
  expect(found, 'exactly one Auth verify link in the mail').toHaveLength(1);
  return found[0];
}

/** Follow the verify link without following the redirect; returns the Location target. */
async function redirectTarget(link: URL): Promise<URL> {
  const res = await fetch(link, { redirect: 'manual' });
  expect([301, 302, 303, 307, 308], `verify status ${res.status}`).toContain(res.status);
  const loc = res.headers.get('location');
  expect(loc, 'verify sets Location').toBeTruthy();
  return new URL(loc!);
}

function expectPkceCallback(target: URL) {
  expect(`${target.protocol}//${target.host}${target.pathname}`).toBe(CALLBACK);
  expect(target.searchParams.get('code'), 'Location has ?code=').toMatch(/\S{8,}/);
  const all = [...target.searchParams.keys(), ...new URLSearchParams(target.hash.slice(1)).keys()];
  expect(all.filter((k) => /token/i.test(k)), 'no token params in Location').toEqual([]);
  expect(target.hash, 'no fragment (implicit flow)').toBe('');
}

const cases = [
  { name: 'existing persona (magic_link mail)', email: PERSONAS.noor.email, id: PERSONAS.noor.id },
  { name: 'new address (sign-up mail)', email: NEW_USER, id: undefined },
];

async function dropNewUser() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = data?.users.find((x) => x.email === NEW_USER);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

describe('QA-11 email sign-in: code + PKCE link (D35, CONTRACTS §10)', () => {
  afterAll(dropNewUser);

  for (const c of cases) {
    describe(c.name, () => {
      it('mail has one 6-digit code and a link that verifies to bonded://auth/callback?code=', async () => {
        if (!c.id) await dropNewUser();
        const { client, mail } = await requestSignIn(c.email);
        const codes = new Set([...sixDigitCodes(mail.text), ...sixDigitCodes(mail.html)]);
        expect(codes.size, 'one distinct 6-digit code in the mail').toBe(1);

        const link = verifyLink(mail);
        expect(link.searchParams.get('redirect_to')).toBe(CALLBACK);
        const target = await redirectTarget(link);
        expectPkceCallback(target);

        // The app's callback: exchange the code with the stored verifier.
        const { data, error } = await client.auth.exchangeCodeForSession(target.searchParams.get('code')!);
        expect(error?.message ?? null).toBeNull();
        expect(data.session?.user.email).toBe(c.email);
        if (c.id) expect(data.session?.user.id).toBe(c.id);

        // A used link can't sign in again: it no longer redirects with a code.
        const again = await fetch(link, { redirect: 'manual' });
        const loc = again.headers.get('location') ?? '';
        expect(loc).not.toMatch(/[?&]code=/);
      });

      it('the code from the mail signs in with verifyOtp type email', async () => {
        const { client, mail } = await requestSignIn(c.email);
        const [code] = sixDigitCodes(mail.text).concat(sixDigitCodes(mail.html));
        expect(code).toMatch(/^\d{6}$/);
        const { data, error } = await client.auth.verifyOtp({ email: c.email, token: code, type: 'email' });
        expect(error?.message ?? null).toBeNull();
        expect(data.session?.user.email).toBe(c.email);
        if (c.id) expect(data.session?.user.id).toBe(c.id);
      });
    });
  }

  it('a wrong code is rejected', async () => {
    const { client, mail } = await requestSignIn(PERSONAS.noor.email);
    const [code] = sixDigitCodes(mail.text);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const { data, error } = await client.auth.verifyOtp({ email: PERSONAS.noor.email, token: wrong, type: 'email' });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });
});
