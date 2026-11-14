// BE-64 (MOB-78b step 4, SEC-21; CONTRACTS §5 `widget_refresh`): the silent push that wakes the
// app to mint a fresh widget token before the device's token expires. Selection and the once-a-day
// claim live in SQL (`due_widget_refreshes`, service-only); this only sends. The payload is fixed:
// no title, body, sound, token, id or user content. It is not a user-visible push, so nothing is
// written to push_log. A claim is kept whatever the delivery outcome (no resend within 24 h).
// Never throws: the reminder run must not fail because of it. Logs carry counts only.
import { log } from './log.ts';
import { type ExpoBackgroundMessage, type PushResult, sendExpoBackgroundPush } from './push.ts';

type Admin = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (columns: string) => {
      in: (column: string, values: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
    };
    delete: () => {
      in: (column: string, values: string[]) => PromiseLike<{ error: unknown }>;
    };
  };
};
export type WidgetRefreshSummary = { widget_refreshed: number; widget_refresh_failed?: true };
export type SendBackground = (messages: ExpoBackgroundMessage[]) => Promise<PushResult>;

export const widgetRefreshMessage = (to: string): ExpoBackgroundMessage => ({
  to,
  data: { type: 'widget_refresh' },
  priority: 'normal',
  _contentAvailable: true,
});

export const deliverWidgetRefreshes = async (
  admin: Admin,
  now: string,
  send: SendBackground = (messages) => sendExpoBackgroundPush(messages),
): Promise<WidgetRefreshSummary> => {
  try {
    const { data, error } = await admin.rpc('due_widget_refreshes', { p_now: now });
    if (error) throw new Error('selection');
    const users = [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))];
    if (!users.length) return { widget_refreshed: 0 };
    const { data: rows, error: tokenError } = await admin.from('push_tokens').select('token')
      .in('user_id', users);
    if (tokenError) throw new Error('tokens');
    const tokens = [...new Set(((rows ?? []) as { token: string }[]).map((row) => row.token))];
    if (!tokens.length) return { widget_refreshed: 0 };
    const result = await send(tokens.map(widgetRefreshMessage));
    if (result.invalidTokens.length) {
      const { error: deleteError } = await admin.from('push_tokens').delete().in(
        'token',
        result.invalidTokens,
      );
      if (deleteError) throw new Error('cleanup');
    }
    log('widget_refresh.sent', { users: users.length, devices: tokens.length });
    return { widget_refreshed: users.length };
  } catch {
    // Claims are kept (no resend within 24 h); the WorkManager / BGTask path still runs.
    log('widget_refresh.failed');
    return { widget_refreshed: 0, widget_refresh_failed: true };
  }
};
