export type ExpoMessage = {
  to: string;
  title?: string;
  body?: string;
  sound?: 'default';
  channelId?: string;
  data?: { type: string; url: string };
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
