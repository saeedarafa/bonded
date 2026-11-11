import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';

import { track } from '@/lib/analytics';
import { toAppError, type AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';
import { useNotificationPrefs, useSaveNotificationPrefs } from '@/features/settings/hooks';
import type { MascotGesture } from '@/ui';

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
    onSuccess: (sent, { kind, amount }) => {
      // Analytics (MOB-24): the gesture kind and the amount only.
      track('little_thing_sent', { kind, amount });
      if (!sent.atLimit) return;
      track('little_thing_limit_hit', { kind });
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
 * "Little things sounds" on 41 (D53, on by default). Since BE-53 / MOB-67 the switch is the server
 * pref `notification_prefs.little_things_sound`: off mutes the in-app gesture sounds **and** the
 * partner's little-things pushes arrive silently. MOB-59 kept it on the phone (MMKV
 * `littlethings:sound`, '0' = off); this store only holds such a local "off" until it is copied to
 * the server once (`useLittleThingsSoundPref`), then the local key is removed. A local "on" (or none)
 * equals the server default, so there is nothing to copy.
 */
export type LocalSoundOffState = { pending: boolean; clear: () => void };

export function createLocalSoundOffStore(storage: KeyValueStorage) {
  let pending = false;
  try {
    pending = storage.getItem('sound') === '0';
    if (!pending) storage.removeItem('sound');
  } catch {
    pending = false;
  }
  return create<LocalSoundOffState>()((set) => ({
    pending,
    clear: () => {
      set({ pending: false });
      try {
        storage.removeItem('sound');
      } catch {
        // Storage unavailable: the copy may run once more after a restart (same value, harmless).
      }
    },
  }));
}

export const useLocalSoundOff = createLocalSoundOffStore(createKeyValueStorage('littlethings:'));

/**
 * The "Little things sounds" switch (41) and the in-app sound rule (24d), from
 * `notification_prefs.little_things_sound` (BE-53). `on` is true until the prefs load (the server
 * default), false while a local MOB-59 "off" waits to be copied. The copy runs once per mount when
 * the prefs are loaded: if the server is already off, the local key is just dropped. `setOn` saves
 * through the normal optimistic prefs upsert (rolled back on failure; `onError` lets 41 say so) and
 * ends any pending copy, because the person's new choice wins.
 */
export function useLittleThingsSoundPref() {
  const prefs = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const pending = useLocalSoundOff((s) => s.pending);
  const clear = useLocalSoundOff((s) => s.clear);
  const tried = useRef(false);
  const loaded = prefs.data !== undefined;
  const server = prefs.data?.little_things_sound;
  const { mutate } = save;

  useEffect(() => {
    if (!pending || !loaded || tried.current) return;
    tried.current = true;
    if (server === false) {
      clear();
      return;
    }
    mutate({ little_things_sound: false }, { onSuccess: clear });
  }, [pending, loaded, server, mutate, clear]);

  const setOn = useCallback(
    (on: boolean, options?: { onError?: () => void }) => {
      clear();
      mutate({ little_things_sound: on }, { onError: options?.onError });
    },
    [clear, mutate],
  );

  return { on: pending ? false : (server ?? true), setOn };
}

/** A gesture moment on Today's hero mascot (MOB-66): a new `id` restarts it. */
export type StagedGesture = MascotGesture & { id: string };

export type GestureStageState = {
  /** The moment Today's hero acts out now (not persisted). */
  current: StagedGesture | null;
  play: (gesture: StagedGesture) => void;
  /** Ends the moment if it is still `id` (or any, without an argument). */
  end: (id?: string) => void;
};

/**
 * Today's hero acting out a little thing (D48, MOB-66): the partner's on arrival (24d), mine when
 * I send one (prototype `mayaSends`). `LittleThings` plays and ends it (after
 * `gestureDurationMs`); `TodayScreen` hands it to the hero `Mascot`.
 */
export const useGestureStage = create<GestureStageState>()((set, get) => ({
  current: null,
  play: (gesture) => set({ current: gesture }),
  end: (id) => {
    if (id === undefined || get().current?.id === id) set({ current: null });
  },
}));
