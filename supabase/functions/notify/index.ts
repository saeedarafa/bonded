import { createAdminClient } from '../_shared/admin.ts';
import { requireInternalSecret } from '../_shared/auth.ts';
import { error, json } from '../_shared/http.ts';
import { log } from '../_shared/log.ts';
import { sendExpoPush } from '../_shared/push.ts';
import { suppression } from '../_shared/rules.ts';
import copy from '../../content/notifications.json' with { type: 'json' };

type Event = {
  type: string;
  record_id: string;
  couple_id: string;
  couple_question_id: string | null;
  actor_user_id: string;
};
type Admin = ReturnType<typeof createAdminClient>;
type Deps = { admin?: Admin; now?: () => Date; send?: typeof sendExpoPush };
const preference: Record<string, string | null> = {
  partner_answered: 'partner_answered',
  both_answered: 'partner_answered',
  thread_activity: 'replies',
  nudge: 'nudges',
  partner_joined: null,
  partner_premium: null,
};
const cap: Record<string, number | null> = {
  partner_answered: 1,
  both_answered: 1,
  thread_activity: null,
  nudge: 1,
  partner_joined: 1,
  partner_premium: 1,
};
const valid = (v: unknown): v is Event =>
  Boolean(
    v && typeof v === 'object' &&
      [
        'partner_answered',
        'both_answered',
        'thread_activity',
        'partner_joined',
        'nudge',
        'partner_premium',
      ]
        .includes((v as Event).type) &&
      typeof (v as Event).record_id === 'string' && typeof (v as Event).couple_id === 'string' &&
      typeof (v as Event).actor_user_id === 'string',
  );
const local = (date: Date, tz: string) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
};

// Placeholder until the PO adds a voice variant to notifications.json (their copy file).
export const VOICE_MESSAGE_BODY = 'Your partner sent a voice message.';
const isVoiceMessage = async (admin: Admin, id: string): Promise<boolean> => {
  try {
    const { data } = await admin.from('thread_messages').select('kind').eq('id', id).maybeSingle();
    return (data as { kind?: string } | null)?.kind === 'voice';
  } catch {
    return false;
  }
};

export const handle = async (
  request: Request,
  authenticate: (request: Request) => Promise<boolean> = requireInternalSecret,
  deps: Deps = {},
): Promise<Response> => {
  if (!await authenticate(request)) return error('UNAUTHORIZED', 'Unauthorized', 401);
  let event: unknown;
  try {
    event = await request.json();
  } catch {
    return error('BAD_REQUEST', 'Invalid notification event', 400);
  }
  if (!valid(event)) return error('BAD_REQUEST', 'Invalid notification event', 400);
  const admin = deps.admin ?? createAdminClient();
  const now = deps.now?.() ?? new Date();
  const send = deps.send ?? sendExpoPush;
  // BE-43 (D46): a voice message says so, with no content (no path, duration or transcript).
  // Voice answers use the normal "answered" copy. Reactions and unknown rows stay generic.
  const voiceMessage = event.type === 'thread_activity' &&
    await isVoiceMessage(admin, event.record_id);
  const { data: members } = await admin.from('couple_members').select('user_id').eq(
    'couple_id',
    event.couple_id,
  ).is('left_at', null);
  let sent = 0, suppressed = 0;
  for (
    const userId of (members ?? []).map((r: { user_id: string }) => r.user_id).filter((
      id: string,
    ) => id !== event.actor_user_id)
  ) {
    const { data: profile } = await admin.from('profiles').select('timezone').eq('id', userId)
      .single();
    const { data: prefs } = await admin.from('notification_prefs').select('*').eq('user_id', userId)
      .single();
    if (!profile || !prefs) {
      suppressed++;
      continue;
    }
    const here = local(now, profile.timezone);
    const pref = preference[event.type];
    const { count: daily } = await admin.from('push_log').select('id', {
      count: 'exact',
      head: true,
    }).eq('user_id', userId).eq('local_date', here.date).in('status', ['claimed', 'sent']);
    const { count: typed } = await admin.from('push_log').select('id', {
      count: 'exact',
      head: true,
    }).eq('user_id', userId).eq('local_date', here.date).eq('type', event.type).in('status', [
      'claimed',
      'sent',
    ]);
    let grouped: number | null = 0;
    if (event.type === 'thread_activity') {
      ({ count: grouped } = await admin.from('push_log').select('id', {
        count: 'exact',
        head: true,
      }).eq('user_id', userId).eq('type', event.type).eq(
        'couple_question_id',
        event.couple_question_id,
      ).gte('created_at', new Date(now.getTime() - 300000).toISOString()));
    }
    if (
      suppression({
        type: event.type,
        localTime: here.time,
        quietStart: prefs.quiet_start.slice(0, 5),
        quietEnd: prefs.quiet_end.slice(0, 5),
        preferenceEnabled: !pref || prefs[pref] !== false,
        dailyCount: daily ?? 0,
        typeCount: typed ?? 0,
        typeCap: cap[event.type],
        groupedCount: grouped ?? 0,
      })
    ) {
      suppressed++;
      continue;
    }
    const { data: claims, error: claimError } = await admin.rpc('claim_push', {
      p_user: userId,
      p_type: event.type,
      p_record: event.record_id,
      p_cq: event.couple_question_id,
      p_local_date: here.date,
      p_now: now.toISOString(),
    });
    if (claimError) {
      log('notify.claim_failed', { type: event.type, record_id: event.record_id });
      return error('INTERNAL_ERROR', 'Notification claim failed', 500);
    }
    const claim = claims?.[0] as { claim_id: string | null } | undefined;
    if (!claim?.claim_id) {
      suppressed++;
      continue;
    }
    const { data: tokens } = await admin.from('push_tokens').select('token').eq('user_id', userId);
    if (!tokens?.length) {
      await admin.from('push_log').update({ status: 'suppressed' }).eq('id', claim.claim_id);
      suppressed++;
      continue;
    }
    const url = event.type === 'partner_premium'
      ? copy.types.partner_premium.url
      : event.type === 'thread_activity'
      ? `bonded://question/${event.couple_question_id}/thread`
      : event.couple_question_id
      ? `bonded://question/${event.couple_question_id}`
      : 'bonded://today';
    let title = 'Bonded';
    let body = voiceMessage
      ? VOICE_MESSAGE_BODY
      : event.type === 'thread_activity'
      ? 'New activity in your conversation.'
      : 'Your partner shared an update.';
    if (event.type === 'partner_premium') {
      const { data: actor } = await admin.from('profiles').select('display_name')
        .eq('id', event.actor_user_id).single();
      const name = typeof actor?.display_name === 'string'
        ? actor.display_name.trim().split(/\s+/)[0].slice(0, 30)
        : '';
      title = copy.types.partner_premium.title;
      body = copy.types.partner_premium.body.replace('{partner}', name || 'Your partner');
    }
    const result = await send(
      tokens.map((r: { token: string }) => ({
        to: r.token,
        title,
        body,
        sound: 'default',
        channelId: event.type,
        data: { type: event.type, url },
      })),
    );
    if (result.invalidTokens.length) {
      await admin.from('push_tokens').delete().in('token', result.invalidTokens);
    }
    await admin.from('push_log').update({ status: 'sent', sent_at: now.toISOString() }).eq(
      'id',
      claim.claim_id,
    );
    sent++;
  }
  log('notify.completed', { type: event.type, record_id: event.record_id, sent, suppressed });
  return json({ sent, suppressed });
};
if (import.meta.main) Deno.serve((request) => handle(request));
