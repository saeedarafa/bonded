import { create } from 'zustand';

/**
 * Thread messages this device is sending (MOB-12). In memory only: a failed message stays here
 * with its `client_id` so "Retry" resends the SAME id (a duplicate is impossible). The offline
 * queue that survives a restart is MOB-14. Wiped on sign-out.
 */
export type OutboxStatus = 'sending' | 'failed' | 'sent';

export type OutboxItem = {
  clientId: string;
  coupleQuestionId: string;
  body: string;
  /** Device time, only to order my pending messages after the server's. */
  createdAt: string;
  status: OutboxStatus;
};

type OutboxState = {
  items: Record<string, OutboxItem>;
  put: (item: OutboxItem) => void;
  setStatus: (clientId: string, status: OutboxStatus) => void;
  remove: (clientIds: string[]) => void;
};

export const useOutbox = create<OutboxState>((set) => ({
  items: {},
  put: (item) => set((s) => ({ items: { ...s.items, [item.clientId]: item } })),
  setStatus: (clientId, status) =>
    set((s) => {
      const item = s.items[clientId];
      return item ? { items: { ...s.items, [clientId]: { ...item, status } } } : s;
    }),
  remove: (clientIds) =>
    set((s) => {
      const items = { ...s.items };
      for (const id of clientIds) delete items[id];
      return { items };
    }),
}));

export function clearOutbox(): void {
  useOutbox.setState({ items: {} });
}
