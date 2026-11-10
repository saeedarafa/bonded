import { create } from 'zustand';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import type { OfferKind } from './api';

/** The server's clock is 24 hours (BE-17): a device clock that is behind never shows more. */
export const OFFER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Time left on a server offer, from the server's `expires_at` (D28: a real countdown, the same on
 * both phones). Clock skew: clamped to 0…24 h, so a device clock that is off never shows a longer
 * window than the server gives, and eligibility always comes from the server, never from this.
 */
export function offerRemainingMs(expiresAt: string | null, now: number): number {
  if (!expiresAt) return 0;
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return 0;
  return Math.min(OFFER_WINDOW_MS, Math.max(0, end - now));
}

/**
 * Offer screens already shown on this device (14 gift, 36 win-back), per couple and kind: "shown
 * once" (D28). Ids only. The server's clock is shared; this only stops the screen re-opening here.
 */
const KEY = 'shown';

export type OfferShownState = {
  shown: string[];
  markShown: (coupleId: string, kind: OfferKind) => void;
  wasShown: (coupleId: string, kind: OfferKind) => boolean;
};

export function createOfferShownStore(storage: KeyValueStorage) {
  let initial: string[] = [];
  try {
    const raw = storage.getItem(KEY);
    initial = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    initial = [];
  }
  return create<OfferShownState>()((set, get) => ({
    shown: initial,
    wasShown: (coupleId, kind) => get().shown.includes(`${coupleId}:${kind}`),
    markShown: (coupleId, kind) => {
      const id = `${coupleId}:${kind}`;
      if (get().shown.includes(id)) return;
      const shown = [...get().shown, id].slice(-20);
      set({ shown });
      try {
        storage.setItem(KEY, JSON.stringify(shown));
      } catch {
        // Storage unavailable: worst case the screen shows once more after a restart.
      }
    },
  }));
}

export const useOfferShown = createOfferShownStore(createKeyValueStorage('offers:'));
