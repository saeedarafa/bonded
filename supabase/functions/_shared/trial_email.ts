// BE-48d (D50): the day-5 trial reminder email, sent through the Resend API next to the
// `trial_ending` push. Claims come from service-only `claim_trial_emails` (one per trial, own
// ledger); outcomes go back through `trial_email_result`. Without RESEND_API_KEY nothing is
// claimed and nothing is sent. Logs carry counts and reason codes only: never the address, the
// name or the body.
import emails from '../../content/emails.json' with { type: 'json' };
import { log } from './log.ts';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const FROM = 'Bonded App <hello@mail.hellobonded.com>';
const SEND_TIMEOUT_MS = 10_000;

export type TrialEmailClaim = {
  claim_id: string;
  email: string;
  first_name: string | null;
  ends_at: string;
  timezone: string | null;
};
export type TrialEmailTemplate = {
  subject: string;
  preheader: string;
  greeting: string;
  greeting_no_name: string;
  paragraphs: string[];
  signoff: string;
  footer: string;
};
export const trialEndingEmail: TrialEmailTemplate = emails.types.trial_ending;

export type BuiltEmail = { subject: string; text: string; html: string };
export type TrialEmailSummary = {
  emailed: number;
  email_failed: number;
  email_skipped?: 'not_configured';
};
type Admin = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
};

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// "Saturday, 8 November" in the recipient's timezone; UTC when the zone is unknown or invalid.
export const formatEndDate = (endsAt: string, timezone: string | null): string => {
  const date = new Date(endsAt);
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  // Assembled from parts: ICU versions differ on the comma after the weekday.
  const format = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('weekday')}, ${part('day')} ${part('month')}`;
  };
  try {
    return format(timezone || 'UTC');
  } catch {
    return format('UTC');
  }
};

// Pure: the email for one claim. The name is user-controlled, so it is escaped in HTML and kept
// out of the subject. Plain HTML, no images, no links that track.
export const buildTrialEmail = (
  claim: Pick<TrialEmailClaim, 'first_name' | 'ends_at' | 'timezone'>,
  template: TrialEmailTemplate = trialEndingEmail,
): BuiltEmail => {
  const name = (claim.first_name ?? '').trim();
  const endDate = formatEndDate(claim.ends_at, claim.timezone);
  const fill = (value: string) => value.replaceAll('{end_date}', endDate);
  const greeting = name ? template.greeting.replaceAll('{name}', name) : template.greeting_no_name;
  const paragraphs = template.paragraphs.map(fill);
  const text = [greeting, ...paragraphs, template.signoff, '--', template.footer].join('\n\n');
  const p = (value: string, style = '') =>
    `<p style="margin:0 0 16px;${style}">${escapeHtml(value)}</p>`;
  const html = '<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:16px;line-height:1.5;color:#1f1a24">' +
    `<div style="display:none;max-height:0;overflow:hidden">${
      escapeHtml(fill(template.preheader))
    }</div>` +
    '<div style="max-width:520px;margin:0 auto">' +
    p(greeting) + paragraphs.map((line) => p(line)).join('') + p(template.signoff) +
    p(template.footer, 'font-size:13px;color:#6b6470;margin-top:32px') +
    '</div></body></html>';
  return { subject: fill(template.subject), text, html };
};

export type SendOutcome = 'sent' | 'rejected' | 'retry' | 'unknown';

// One Resend call. 2xx = sent; 429/5xx = retry later; other 4xx = rejected (never retried);
// a network error or timeout = unknown (the claim is kept, so nothing is sent twice). The
// Idempotency-Key makes a replayed request a no-op on Resend's side as well.
export const sendTrialEmail = async (
  apiKey: string,
  claim: TrialEmailClaim,
  fetchImpl: typeof fetch = fetch,
): Promise<{ outcome: SendOutcome; status?: number }> => {
  const built = buildTrialEmail(claim);
  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `trial-email/${claim.claim_id}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [claim.email],
        subject: built.subject,
        text: built.text,
        html: built.html,
        tags: [{ name: 'type', value: 'trial_ending' }],
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (response.ok) return { outcome: 'sent', status: response.status };
    if (response.status === 429 || response.status >= 500) {
      return { outcome: 'retry', status: response.status };
    }
    return { outcome: 'rejected', status: response.status };
  } catch {
    return { outcome: 'unknown' };
  }
};

// Claims due emails and sends them one by one. Never throws: email trouble must not stop the
// pushes in daily-reminder.
export const deliverTrialEmails = async (
  admin: Admin,
  now: string,
  deps: { apiKey?: string; fetch?: typeof fetch } = {},
): Promise<TrialEmailSummary> => {
  const apiKey = (deps.apiKey ?? Deno.env.get('RESEND_API_KEY') ?? '').trim();
  if (!apiKey) {
    log('trial_email.skipped', { reason: 'not_configured' });
    return { emailed: 0, email_failed: 0, email_skipped: 'not_configured' };
  }
  let emailed = 0, failed = 0;
  try {
    const { data, error } = await admin.rpc('claim_trial_emails', { p_now: now });
    if (error) {
      log('trial_email.failed', { reason: 'claim_failed' });
      return { emailed: 0, email_failed: 0 };
    }
    for (const claim of (data ?? []) as TrialEmailClaim[]) {
      const { outcome, status } = await sendTrialEmail(apiKey, claim, deps.fetch ?? fetch);
      if (outcome === 'unknown') {
        failed++;
        log('trial_email.failed', { reason: 'unknown_outcome' });
        continue;
      }
      if (outcome === 'sent') emailed++;
      else {
        failed++;
        log('trial_email.failed', { reason: outcome, status });
      }
      const { error: resultError } = await admin.rpc('trial_email_result', {
        p_claim: claim.claim_id,
        p_outcome: outcome,
        p_now: now,
      });
      if (resultError) log('trial_email.failed', { reason: 'result_failed' });
    }
  } catch {
    log('trial_email.failed', { reason: 'internal' });
  }
  if (emailed || failed) log('trial_email.completed', { emailed, failed });
  return { emailed, email_failed: failed };
};
