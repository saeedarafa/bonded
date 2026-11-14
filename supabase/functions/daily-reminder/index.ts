import { createAdminClient } from '../_shared/admin.ts';
import { requireInternalSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { sendExpoPush } from '../_shared/push.ts';
import { deliverTrialEmails } from '../_shared/trial_email.ts';
import { deliverWidgetRefreshes } from '../_shared/widget_refresh.ts';
import copy from '../../content/notifications.json' with { type: 'json' };

type Reminder = {
  user_id: string;
  type:
    | 'ritual_reminder'
    | 'last_call'
    | 'weekly_recap'
    | 'trial_ending'
    | 'offer_ending'
    | 'cancel_offer';
  claim_id: string;
  streak?: number;
  partner_name?: string;
  partner_answered?: boolean;
  days_together?: number;
  days_left?: number;
  minutes_left?: number;
};
type Template = { title: string; body: string; url?: string; partner_fallback?: string };
// BE-52 (PO 2026-11-11, approved copy in notifications.json): `trial_ending` (BE-48, D50) and
// `offer_ending` (BE-47, D52, the day-3 gift). No price in any push (tested); the offer itself is
// shown from RevenueCat on screen 15.
export const trialEnding: Template = copy.types.trial_ending;
export const offerEnding: Template = copy.types.offer_ending;
// BE-62 (c) (D61, PO 2026-11-13): one push after a store-side cancel of a running App Store trial
// or Yearly plan (claimed by `due_cancel_offers`); opens the in-app cancel offer screen.
export const cancelOffer: Template = copy.types.cancel_offer;
type Deps = {
  admin?: ReturnType<typeof createAdminClient>;
  now?: () => Date;
  send?: typeof sendExpoPush;
  // BE-48d: the day-5 trial email (Resend). Skipped cleanly without RESEND_API_KEY.
  emails?: (admin: never, now: string) => ReturnType<typeof deliverTrialEmails>;
  // BE-64: the silent widget_refresh push (CONTRACTS §5). Never throws.
  widgetRefresh?: (admin: never, now: string) => ReturnType<typeof deliverWidgetRefreshes>;
};
export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<boolean> = requireInternalSecret,
  deps: Deps = {},
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  // A missing deployment configuration is a server error, never a reason to accept a caller clock.
  try {
    const admin = deps.admin ?? createAdminClient();
    const now = (deps.now?.() ?? new Date()).toISOString();
    const { data, error: selectionError } = await admin.rpc('due_reminders', { p_now: now });
    if (selectionError) return error('INTERNAL_ERROR', 'Reminder selection failed', 500);
    const { data: recaps, error: recapError } = await admin.rpc('due_weekly_recaps', {
      p_now: now,
    });
    if (recapError) return error('INTERNAL_ERROR', 'Recap selection failed', 500);
    const { data: trials, error: trialError } = await admin.rpc('due_trial_endings', {
      p_now: now,
    });
    if (trialError) return error('INTERNAL_ERROR', 'Trial selection failed', 500);
    const { data: offers, error: offerError } = await admin.rpc('due_offer_endings', {
      p_now: now,
    });
    if (offerError) return error('INTERNAL_ERROR', 'Offer selection failed', 500);
    const { data: cancels, error: cancelError } = await admin.rpc('due_cancel_offers', {
      p_now: now,
    });
    if (cancelError) return error('INTERNAL_ERROR', 'Cancel offer selection failed', 500);
    const reminders: Reminder[] = [
      ...(data ?? []),
      ...(recaps ?? []).map((recap: Omit<Reminder, 'type'>) => ({
        ...recap,
        type: 'weekly_recap' as const,
      })),
      ...(trials ?? []).map((trial: Omit<Reminder, 'type'>) => ({
        ...trial,
        type: 'trial_ending' as const,
      })),
      ...(offers ?? []).map((offer: Omit<Reminder, 'type'>) => ({
        ...offer,
        type: 'offer_ending' as const,
      })),
      ...(cancels ?? []).map((cancel: Omit<Reminder, 'type'>) => ({
        ...cancel,
        type: 'cancel_offer' as const,
      })),
    ];
    let sent = 0;
    for (const reminder of reminders) {
      const { data: tokens, error: tokenError } = await admin.from('push_tokens').select('token')
        .eq('user_id', reminder.user_id);
      if (tokenError) return error('INTERNAL_ERROR', 'Reminder tokens unavailable', 500);
      if (!tokens?.length) {
        const { error: updateError } = await admin.from('push_log').update({ status: 'suppressed' })
          .eq('id', reminder.claim_id);
        if (updateError) return error('INTERNAL_ERROR', 'Reminder update failed', 500);
        continue;
      }
      const template: Template = reminder.type === 'cancel_offer'
        ? cancelOffer
        : reminder.type === 'offer_ending'
        ? offerEnding
        : reminder.type === 'trial_ending'
        ? trialEnding
        : reminder.type === 'weekly_recap'
        ? copy.types.weekly_recap
        : reminder.type === 'last_call'
        ? copy.types.last_call
        : reminder.partner_answered && reminder.partner_name
        ? copy.types.ritual_reminder.variants.partner_answered
        : copy.types.ritual_reminder.variants.default;
      // Offer pushes name the partner, or the approved fallback when the name is unknown/blank.
      const partner = reminder.partner_name?.trim() || template.partner_fallback || '';
      const fill = (value: string) =>
        value.replaceAll('{partner}', () => partner).replaceAll(
          '{streak}',
          String(reminder.streak ?? 0),
        ).replaceAll(
          '{days}',
          String(
            reminder.type === 'trial_ending'
              ? reminder.days_left ?? 0
              : reminder.days_together ?? 0,
          ),
        );
      const result = await (deps.send ?? sendExpoPush)(
        tokens.map((row: { token: string }) => ({
          to: row.token,
          title: fill(template.title),
          body: fill(template.body),
          sound: 'default',
          channelId: reminder.type,
          data: {
            type: reminder.type,
            url: reminder.type === 'weekly_recap'
              ? copy.types.weekly_recap.url
              : reminder.type === 'trial_ending'
              ? trialEnding.url ?? 'bonded://today'
              : reminder.type === 'offer_ending'
              ? offerEnding.url ?? 'bonded://today'
              : reminder.type === 'cancel_offer'
              ? cancelOffer.url ?? 'bonded://today'
              : 'bonded://today',
          },
        })),
      );
      if (result.invalidTokens.length) {
        const { error: deleteError } = await admin.from('push_tokens').delete().in(
          'token',
          result.invalidTokens,
        );
        if (deleteError) return error('INTERNAL_ERROR', 'Token cleanup failed', 500);
      }
      const { error: updateError } = await admin.from('push_log').update({
        status: 'sent',
        sent_at: now,
      })
        .eq('id', reminder.claim_id);
      if (updateError) return error('INTERNAL_ERROR', 'Reminder update failed', 500);
      sent++;
    }
    // BE-64: after the user-visible pushes; its own claims, never counted toward D24. Never throws.
    const widget = await (deps.widgetRefresh ?? deliverWidgetRefreshes)(admin as never, now);
    // BE-48d: after the pushes, so email trouble never delays or blocks them. Never throws.
    const mail = await (deps.emails ?? deliverTrialEmails)(admin as never, now);
    log('reminders.completed', { sent });
    return json({
      sent,
      ...(mail.email_skipped ? {} : { emailed: mail.emailed, email_failed: mail.email_failed }),
      ...(widget.widget_refreshed || widget.widget_refresh_failed ? widget : {}),
    });
  } catch {
    // Unknown send outcomes keep their claims, preventing duplicates on the next cron invocation.
    log('reminders.failed');
    return error('INTERNAL_ERROR', 'Reminder delivery failed', 500);
  }
};
if (import.meta.main) Deno.serve((request) => handle(request));
