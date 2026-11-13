import { assert, assertEquals, assertFalse, assertMatch } from 'jsr:@std/assert@1';
import emails from '../../content/emails.json' with { type: 'json' };
import {
  buildTrialEmail,
  deliverTrialEmails,
  formatEndDate,
  FROM,
  RESEND_ENDPOINT,
  trialEndingEmail,
} from './trial_email.ts';

const NOW = '2026-11-05T10:00:00.000Z';
const claim = (n: number, extra: Record<string, unknown> = {}) => ({
  claim_id: `FIXTURE-claim-${n}`,
  email: `fixture${n}@example.test`,
  first_name: 'Alex',
  ends_at: '2026-11-08T10:00:00Z',
  timezone: 'Europe/Berlin',
  ...extra,
});

type Call = { name: string; args: Record<string, unknown> };
const fakeAdmin = (rows: unknown[], options: { claimError?: boolean } = {}) => {
  const calls: Call[] = [];
  const handed = new Set<string>();
  return {
    calls,
    admin: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === 'claim_trial_emails') {
          // The DB hands each trial out once (own ledger): a second tick returns nothing.
          const fresh = rows.filter((r) => !handed.has((r as { claim_id: string }).claim_id));
          fresh.forEach((r) => handed.add((r as { claim_id: string }).claim_id));
          return Promise.resolve({ data: fresh, error: options.claimError ? {} : null });
        }
        return Promise.resolve({ data: true, error: null });
      },
    },
  };
};
const fakeResend = (statuses: (number | 'throw')[] = [200]) => {
  const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  let i = 0;
  const impl = ((url: string, init: RequestInit) => {
    requests.push({ url, init, body: JSON.parse(String(init.body)) });
    const status = statuses[Math.min(i++, statuses.length - 1)];
    if (status === 'throw') return Promise.reject(new Error('FIXTURE network'));
    return Promise.resolve(new Response('{"id":"FIXTURE"}', { status }));
  }) as typeof fetch;
  return { impl, requests };
};
const captureLogs = async (run: () => Promise<unknown>) => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
};

Deno.test('no RESEND_API_KEY: nothing claimed, nothing sent, reason logged', async () => {
  const { admin, calls } = fakeAdmin([claim(1)]);
  const resend = fakeResend();
  let result;
  const logs = await captureLogs(async () => {
    result = await deliverTrialEmails(admin, NOW, { apiKey: '  ', fetch: resend.impl });
  });
  assertEquals(result, { emailed: 0, email_failed: 0, email_skipped: 'not_configured' });
  assertEquals(calls.length, 0);
  assertEquals(resend.requests.length, 0);
  assertMatch(logs, /"reason":"not_configured"/);
});

Deno.test('one email per claim through Resend, from Bonded App, recorded as sent', async () => {
  const { admin, calls } = fakeAdmin([claim(1)]);
  const resend = fakeResend([200]);
  const result = await deliverTrialEmails(admin, NOW, { apiKey: 're_FIXTURE', fetch: resend.impl });
  assertEquals(result, { emailed: 1, email_failed: 0 });
  assertEquals(calls[0], { name: 'claim_trial_emails', args: { p_now: NOW } });
  assertEquals(calls[1], {
    name: 'trial_email_result',
    args: { p_claim: 'FIXTURE-claim-1', p_outcome: 'sent', p_now: NOW },
  });
  assertEquals(resend.requests.length, 1);
  const [{ url, init, body }] = resend.requests;
  assertEquals(url, RESEND_ENDPOINT);
  assertEquals(init.method, 'POST');
  const headers = init.headers as Record<string, string>;
  assertEquals(headers.Authorization, 'Bearer re_FIXTURE');
  assertEquals(headers['Idempotency-Key'], 'trial-email/FIXTURE-claim-1');
  assertEquals(body.from, 'Bonded App <hello@mail.hellobonded.com>');
  assertEquals(FROM, emails._meta.from);
  assertEquals(body.to, ['fixture1@example.test']);
  assertEquals(body.subject, 'Your free trial ends on Sunday, 8 November');
  assertMatch(String(body.text), /^Hi Alex,/);
});

Deno.test('a second run does not send again (one email per trial)', async () => {
  const { admin } = fakeAdmin([claim(1)]);
  const resend = fakeResend([200]);
  await deliverTrialEmails(admin, NOW, { apiKey: 're_FIXTURE', fetch: resend.impl });
  const again = await deliverTrialEmails(admin, NOW, { apiKey: 're_FIXTURE', fetch: resend.impl });
  assertEquals(again, { emailed: 0, email_failed: 0 });
  assertEquals(resend.requests.length, 1);
});

Deno.test('outcomes: 4xx rejected, 429/5xx retry, network error keeps the claim', async () => {
  const { admin, calls } = fakeAdmin([claim(1), claim(2), claim(3), claim(4)]);
  const resend = fakeResend([422, 429, 503, 'throw']);
  const result = await deliverTrialEmails(admin, NOW, { apiKey: 're_FIXTURE', fetch: resend.impl });
  assertEquals(result, { emailed: 0, email_failed: 4 });
  const outcomes = calls.filter((c) => c.name === 'trial_email_result').map((c) => [
    c.args.p_claim,
    c.args.p_outcome,
  ]);
  assertEquals(outcomes, [
    ['FIXTURE-claim-1', 'rejected'],
    ['FIXTURE-claim-2', 'retry'],
    ['FIXTURE-claim-3', 'retry'],
  ]);
});

Deno.test('claim failure is logged and never throws', async () => {
  const { admin } = fakeAdmin([claim(1)], { claimError: true });
  const resend = fakeResend();
  assertEquals(await deliverTrialEmails(admin, NOW, { apiKey: 're_FIXTURE', fetch: resend.impl }), {
    emailed: 0,
    email_failed: 0,
  });
  assertEquals(resend.requests.length, 0);
});

Deno.test('logs never contain the address, the name or the body', async () => {
  const { admin } = fakeAdmin([claim(1, { first_name: 'Zebulon' }), claim(2)]);
  const resend = fakeResend([200, 422]);
  const logs = await captureLogs(() =>
    deliverTrialEmails(admin, NOW, { apiKey: 're_FIXTURE', fetch: resend.impl })
  );
  assertFalse(/@example\.test|Zebulon|re_FIXTURE|free trial/i.test(logs));
  assertMatch(logs, /"reason":"rejected"/);
});

Deno.test('payload carries no answer text, partner name, price, image or tracking', async () => {
  const { admin } = fakeAdmin([claim(1)]);
  const resend = fakeResend([200]);
  await deliverTrialEmails(admin, NOW, { apiKey: 're_FIXTURE', fetch: resend.impl });
  const body = resend.requests[0].body;
  assertEquals(Object.keys(body).sort(), ['from', 'html', 'subject', 'tags', 'text', 'to']);
  const all = `${body.subject}\n${body.text}\n${body.html}`;
  assertFalse(/<img|<a |https?:\/\/|\{[a-z_]+\}/i.test(all));
  assertFalse(/[$€£¥]|\d+[.,]\d{2}|\d+\s?%/.test(all));
});

Deno.test('the draft copy has no price, percentage, partner placeholder or unknown placeholder', () => {
  const template = trialEndingEmail as unknown as Record<string, string | string[]>;
  const all = Object.values(template).flat().join('\n');
  assertFalse(/[$€£¥]|\d+[.,]\d{2}|\d+\s?%/.test(all));
  for (const match of all.matchAll(/\{([a-z_]+)\}/g)) {
    assert(['name', 'end_date'].includes(match[1]), `unknown placeholder ${match[0]}`);
  }
  assertEquals(emails.types.trial_ending.status, 'draft');
});

Deno.test('the name is escaped in HTML and absent from the subject; blank name uses the fallback', () => {
  const built = buildTrialEmail({
    first_name: '<b>Al&x</b>',
    ends_at: '2026-11-08T10:00:00Z',
    timezone: 'UTC',
  });
  assertFalse(built.html.includes('<b>Al'));
  assert(built.html.includes('Hi &lt;b&gt;Al&amp;x&lt;/b&gt;,'));
  assertFalse(built.subject.includes('Al'));
  const blank = buildTrialEmail({
    first_name: '  ',
    ends_at: '2026-11-08T10:00:00Z',
    timezone: null,
  });
  assertMatch(blank.text, /^Hi there,/);
});

Deno.test('end date uses the recipient timezone and falls back to UTC', () => {
  // 23:30 UTC on 7 Nov is already 8 Nov in Berlin.
  assertEquals(formatEndDate('2026-11-07T23:30:00Z', 'Europe/Berlin'), 'Sunday, 8 November');
  assertEquals(formatEndDate('2026-11-07T23:30:00Z', 'Not/AZone'), 'Saturday, 7 November');
  assertEquals(formatEndDate('2026-11-07T23:30:00Z', null), 'Saturday, 7 November');
});
