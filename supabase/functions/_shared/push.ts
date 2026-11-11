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

type ExpoTicket = { status: 'ok' | 'error'; details?: { error?: string } };
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type PushResult = { tickets: ExpoTicket[]; invalidTokens: string[] };

const chunks = <T>(values: T[], size: number): T[][] =>
  Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );

// Expo accepts up to 100 messages. The caller owns dedupe and notification policy.
export const sendExpoPush = async (
  messages: ExpoMessage[],
  fetchFn: Fetch = fetch,
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
