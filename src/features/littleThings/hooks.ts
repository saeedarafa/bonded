import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { toAppError, type AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import {
  getLittleThingsToday,
  getRecentLittleThings,
  sendLittleThing,
  undoLittleThing,
  type SentLittleThing,
} from './api';
import type { LittleThingKind, LittleThingsToday, Moment, ReceivedRow } from './model';

/** Which kinds are at today's limit (greys fan items). Refetched on focus and after each send. */
export function useLittleThingsToday({ enabled }: { enabled: boolean }) {
  return useQuery<LittleThingsToday, AppError>({
    queryKey: queryKeys.littleThings.today(),
    queryFn: getLittleThingsToday,
    enabled,
  });
}

export type SendInput = { kind: LittleThingKind; amount: number; clientId: string };

/**
 * `send_little_thing`. The variables carry one `clientId` per gesture, so TanStack's retries
 * (network or unknown errors only) reuse it and the server counts the gesture once.
 */
export function useSendLittleThing() {
  const queryClient = useQueryClient();
  return useMutation<SentLittleThing, AppError, SendInput>({
    mutationFn: sendLittleThing,
    retry: (failureCount, error) => toAppError(error).retryable && failureCount < 2,
    retryDelay: 800,
    onSuccess: (sent, { kind }) => {
      if (!sent.atLimit) return;
      queryClient.setQueryData<LittleThingsToday>(queryKeys.littleThings.today(), (old) =>
        old ? { ...old, [kind]: { ...old[kind], atLimit: true } } : old,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.littleThings.all }),
  });
}

/** `undo_little_thing`: the server answers with today's state after the undo. */
export function useUndoLittleThing() {
  const queryClient = useQueryClient();
  return useMutation<LittleThingsToday, AppError, string>({
    mutationFn: undoLittleThing,
    retry: false,
    onSuccess: (today) => queryClient.setQueryData(queryKeys.littleThings.today(), today),
  });
}

/** The one-time tip on 24b, per phone. A flag only. */
const TIP_KEY = 'tipSeen';

export type LittleThingsTipState = { seen: boolean; markSeen: () => void };

export function createLittleThingsTipStore(storage: KeyValueStorage) {
  let initial = false;
  try {
    initial = storage.getItem(TIP_KEY) === '1';
  } catch {
    initial = false;
  }
  return create<LittleThingsTipState>()((set) => ({
    seen: initial,
    markSeen: () => {
      set({ seen: true });
      try {
        storage.setItem(TIP_KEY, '1');
      } catch {
        // Storage unavailable: the tip may show once more after a restart.
      }
    },
  }));
}

export const useLittleThingsTip = createLittleThingsTipStore(
  createKeyValueStorage('littlethings:'),
);

/** The couple's recent gestures for 24d. Realtime on `little_things` invalidates it. */
export function useRecentLittleThings({
  coupleId,
  enabled,
}: {
  coupleId: string | null | undefined;
  enabled: boolean;
}) {
  return useQuery<ReceivedRow[], AppError>({
    queryKey: queryKeys.littleThings.received(coupleId ?? ''),
    queryFn: () => getRecentLittleThings(coupleId ?? ''),
    enabled: enabled && !!coupleId,
  });
}

/**
 * The newest gesture already acted out on this phone, per person (so a gesture plays once, and a
 * second account on the same phone starts fresh). An ISO time only, never content.
 */
export type LittleThingsSeenState = {
  seen: Record<string, string>;
  /** The 24d moment on screen now (not persisted). */
  moment: Moment | null;
  seenAt: (userId: string) => string | null;
  markSeen: (userId: string, at: string) => void;
  /** Shows a moment and marks its newest gesture seen, so it plays once. */
  show: (userId: string, moment: Moment) => void;
  /** Hides the moment if it is still `which` (or any, without an argument). */
  dismiss: (which?: Moment) => void;
};

export function createLittleThingsSeenStore(storage: KeyValueStorage) {
  const key = (userId: string) => `seenAt:${userId}`;
  const read = (userId: string): string | null => {
    try {
      return storage.getItem(key(userId));
    } catch {
      return null;
    }
  };
  return create<LittleThingsSeenState>()((set, get) => ({
    seen: {},
    moment: null,
    show: (userId, moment) => {
      get().markSeen(userId, moment.newestAt);
      set({ moment });
    },
    dismiss: (which) => {
      if (which === undefined || get().moment === which) set({ moment: null });
    },
    seenAt: (userId) => get().seen[userId] ?? read(userId),
    markSeen: (userId, at) => {
      const current = get().seenAt(userId);
      if (current && Date.parse(current) >= Date.parse(at)) return;
      set((s) => ({ seen: { ...s.seen, [userId]: at } }));
      try {
        storage.setItem(key(userId), at);
      } catch {
        // Storage unavailable: the moment may play once more after a restart.
      }
    },
  }));
}

export const useLittleThingsSeen = createLittleThingsSeenStore(
  createKeyValueStorage('littlethings:'),
);

/**
 * "Little things sounds" on 41 (D53, on by default): in-app gesture sounds on this phone. Local,
 * because the contract has no server column for it; push sounds follow the phone's notification
 * settings (the per-gesture Android channels, iOS sounds).
 */
export type LittleThingsSoundState = { on: boolean; setOn: (on: boolean) => void };

export function createLittleThingsSoundStore(storage: KeyValueStorage) {
  let initial = true;
  try {
    initial = storage.getItem('sound') !== '0';
  } catch {
    initial = true;
  }
  return create<LittleThingsSoundState>()((set) => ({
    on: initial,
    setOn: (on) => {
      set({ on });
      try {
        storage.setItem('sound', on ? '1' : '0');
      } catch {
        // Storage unavailable: the choice lasts until the app restarts.
      }
    },
  }));
}

export const useLittleThingsSound = createLittleThingsSoundStore(
  createKeyValueStorage('littlethings:'),
);
