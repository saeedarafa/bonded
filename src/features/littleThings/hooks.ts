import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { toAppError, type AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import {
  getLittleThingsToday,
  sendLittleThing,
  undoLittleThing,
  type SentLittleThing,
} from './api';
import type { LittleThingKind, LittleThingsToday } from './model';

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
