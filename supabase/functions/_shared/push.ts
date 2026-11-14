export type ExpoMessage = {
  to: string;
  title?: string;
  body?: string;
  // 'default' or a bundled custom sound file name (BE-45 little things); omitted = silent.
  sound?: string;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  // iOS 15+: 'passive' = no sound, no screen wake (BE-45 quiet hours).
  interruptionLevel?: 'active' | 'passive';
  data?: {
    type: string;
    url: string;
    gesture?: string;
    gestures?: Record<string, number>;
    silent?: boolean;
  };
};

// BE-64 (CONTRACTS §5 `widget_refresh`): a silent, data-only background push. No title, body,
// sound, badge or channel. `_contentAvailable` makes Expo set APNs `content-available: 1`; APNs
// only accepts a background push at priority 5, which is Expo's 'normal'. On Android, Expo sends a
// data-only FCM message (no notification block) at normal priority.
export type ExpoBackgroundMessage = {
  to: string;
  data: { type: 'widget_refresh' };
  priority: 'normal';
  _contentAvailable: true;
};

type ExpoTicket = { status: 'ok' | 'error'; details?: { error?: string } };
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type PushResult = { tickets: ExpoTicket[]; invalidTokens: string[] };

const chunks = <T>(values: T[], size: number): T[][] =>
  Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );

// Expo accepts up to 100 messages. The caller owns dedupe and notification policy.
export const sendExpoPush = (
  messages: ExpoMessage[],
  fetchFn: Fetch = fetch,
): Promise<PushResult> => sendExpoMessages(messages, fetchFn);

// BE-64: the silent widget_refresh push (same transport, same token cleanup).
export const sendExpoBackgroundPush = (
  messages: ExpoBackgroundMessage[],
  fetchFn: Fetch = fetch,
): Promise<PushResult> => sendExpoMessages(messages, fetchFn);

const sendExpoMessages = async (
  messages: (ExpoMessage | ExpoBackgroundMessage)[],
  fetchFn: Fetch,
): Promise<PushResult> => {
  const tickets: ExpoTicket[] = [];
  const invalidTokens: string[] = [];
  for (const batch of chunks(messages, 100)) {
    const response = await fetchFn('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`EXPO_PUSH_${response.status}`);
    const payload = await response.json() as { data?: ExpoTicket[] };
    const batchTickets = payload.data ?? [];
    tickets.push(...batchTickets);
    batchTickets.forEach((ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        invalidTokens.push(batch[index].to);
      }
    });
  }
  return { tickets, invalidTokens };
};
