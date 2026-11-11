import { create } from 'zustand';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import { syncRevenueCat, type SyncResult } from './api';
import { ensureIdentified, purchasesAvailable } from './purchases';

/**
 * MOB-62 (D50): a purchase or restore made on P3 **before** sign-in, under RevenueCat's anonymous
 * id. Kept in the encrypted MMKV store (prefix `purchasePending:`) so an app kill between P3 and
 * sign-in loses nothing. At sign-in `syncPendingPurchase` runs the CONTRACTS §6 order:
 * `Purchases.logIn(uid)` (aliases the anonymous purchase to the account) → `revenuecat-sync` (no
 * webhook fires for the alias) → the caller refetches `entitlements`. Premium is shown only once
 * the server row says so; this flag never grants anything.
 *
 * Separate from the onboarding pending store: `ALREADY_PAIRED` drops T1, never a purchase. Holds
 * a boolean only (no receipt, product or price). Storage failures are swallowed.
 */
type PendingPurchaseState = {
  /** A P3 purchase/restore still has to be moved to the account. */
  pending: boolean;
  mark: () => void;
  clear: () => void;
};

const STORAGE_KEY = 'p3';

export function createPendingPurchaseStore(storage: KeyValueStorage) {
  let initial = false;
  try {
    initial = storage.getItem(STORAGE_KEY) === '1';
  } catch {
    initial = false;
  }
  const store = create<PendingPurchaseState>()((set) => ({
    pending: initial,
    mark: () => set({ pending: true }),
    clear: () => set({ pending: false }),
  }));
  store.subscribe((state) => {
    try {
      if (state.pending) storage.setItem(STORAGE_KEY, '1');
      else storage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable: kept in memory for this launch.
    }
  });
  return store;
}

export const usePendingPurchase = createPendingPurchaseStore(
  createKeyValueStorage('purchasePending:'),
);

export type PendingSyncResult = 'none' | SyncResult;

let inFlight: { userId: string; promise: Promise<PendingSyncResult> } | null = null;

/**
 * Moves a P3 purchase to the signed-in account (logIn, then `revenuecat-sync`). `none` when there
 * is nothing to move. Never throws. Concurrent callers (the setup after sign-in and the session's
 * RevenueCat identity) share one attempt, so the 30 s server rate limit is never hit by the app
 * itself. The flag is cleared only after the server confirmed the sync.
 */
export function syncPendingPurchase(userId: string): Promise<PendingSyncResult> {
  if (!usePendingPurchase.getState().pending) return Promise.resolve('none');
  if (inFlight && inFlight.userId === userId) return inFlight.promise;
  const promise = (async (): Promise<PendingSyncResult> => {
    if (!purchasesAvailable()) return 'retry';
    if (!(await ensureIdentified(userId))) return 'retry';
    const result = await syncRevenueCat();
    if (result === 'ok') usePendingPurchase.getState().clear();
    return result;
  })();
  const entry = { userId, promise };
  inFlight = entry;
  void promise.finally(() => {
    if (inFlight === entry) inFlight = null;
  });
  return promise;
}
