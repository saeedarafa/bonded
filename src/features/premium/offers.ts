import { create } from 'zustand';

import { formatCountdown } from '@/features/daily/today';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import type { Plan } from './purchases';

/** The only offer left (D52): the day-3 gift. `intro` and `winback` are retired. */
export type OfferKind = 'day3';

/**
 * The day-3 gift's window (D52, BE-47): 12 hours from the first open. A device clock that is off
 * never shows more than this.
 */
export const OFFER_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * The gift's discount as decided (D57: 50%, was 25% in D52), for copy shown only before the
 * `day3` offering's prices load. Once they load, the store's own prices decide (`introPercent`).
 */
export const DAY3_PERCENT = 50;

/**
 * `get_offer('day3')` / `open_offer('day3')` as the app keeps it (CONTRACTS §2). `eligible` is the
 * server's word and the only one: the app never decides the gift. `leftAtReceipt` is
 * `expires_at - server_now` at the moment the answer arrived (the server's clock, not the phone's),
 * and `receivedAt` is that moment on the phone's monotonic clock: the countdown runs from there.
 */
export type ServerOffer = {
  eligible: boolean;
  /** Opened by either partner: the shared 12-hour clock runs (`expires_at` is set). */
  opened: boolean;
  expiresAt: string | null;
  leftAtReceipt: number;
  receivedAt: number;
};

/** A monotonic clock (ms): unaffected by the person changing the phone's time. */
export function monotonicNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

/**
 * Reads the RPC's JSON without trusting its shape. Time left uses the server's own `server_now`
 * (clock skew); without it, the phone's clock at receipt. Clamped to 0…12 h. Anything unexpected
 * reads as "no gift".
 */
export function toServerOffer(
  data: unknown,
  wallNow: number = Date.now(),
  receivedAt: number = monotonicNow(),
): ServerOffer {
  const row = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const raw = typeof row.expires_at === 'string' ? row.expires_at : null;
  const end = raw ? Date.parse(raw) : NaN;
  const expiresAt = Number.isFinite(end) ? raw : null;
  const serverNow = typeof row.server_now === 'string' ? Date.parse(row.server_now) : NaN;
  const base = Number.isFinite(serverNow) ? serverNow : wallNow;
  return {
    eligible: row.eligible === true,
    opened: expiresAt !== null,
    expiresAt,
    leftAtReceipt: expiresAt ? Math.min(OFFER_WINDOW_MS, Math.max(0, end - base)) : 0,
    receivedAt,
  };
}

/** Milliseconds left on an opened offer at monotonic time `now`; 0 when unopened or over. */
export function offerRemainingMs(offer: ServerOffer | null | undefined, now: number): number {
  if (!offer?.opened) return 0;
  return Math.max(0, offer.leftAtReceipt - Math.max(0, now - offer.receivedAt));
}

/**
 * "11:59:42": the live countdown on 15, Today's gift chip and the Us Premium row (PO bug
 * 2026-11-12: "12:00" read as noon). Seconds rounded **up**, so a live offer never reads 00:00:00;
 * at zero the offer is over and nothing shows it.
 */
export function offerCountdown(ms: number): string {
  return formatCountdown(Math.ceil(Math.max(0, ms) / 1000));
}

/** "11 hours 42 minutes" for the screen reader (minutes rounded up, so never "0 minutes"). */
export function countdownParts(ms: number): { hours: number; minutes: number } {
  const total = Math.ceil(Math.max(0, ms) / 60_000);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * "50% off" from the store's own prices: 1 − intro ÷ regular, rounded **down** so it is never
 * overstated. Null when either is unknown (the copy then uses the decided `DAY3_PERCENT`).
 */
export function introPercent(plan: Plan | undefined): number | null {
  const regular = plan?.amount ?? null;
  const intro = plan?.introOffer?.amount ?? null;
  if (regular === null || intro === null || !(regular > 0) || !(intro > 0)) return null;
  const pct = Math.floor((1 - intro / regular) * 100 + 1e-9);
  return pct >= 1 && pct < 100 ? pct : null;
}

/**
 * Gift screens opened by themselves on this device (14), per couple: at most once here. Ids only.
 * The server's clock is shared; this only stops the screen re-opening on this phone.
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

/**
 * D57 exit offer on P3 before sign-in (CONTRACTS §2 `open_exit_offer`, D50): there is no session,
 * so this phone remembers that the sheet showed (`shown`: never again on this device) and that the
 * server must still be told (`toRecord`: `open_exit_offer('paywall_close')` once right after
 * sign-in, result ignored, so 16 never shows it again). No ids, no prices.
 */
export type ExitOfferDeviceState = {
  shown: boolean;
  toRecord: boolean;
  markShown: () => void;
  recorded: () => void;
};

export function createExitOfferDeviceStore(storage: KeyValueStorage) {
  const read = (key: string) => {
    try {
      return storage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  const write = (key: string, on: boolean) => {
    try {
      if (on) storage.setItem(key, '1');
      else storage.removeItem(key);
    } catch {
      // Storage unavailable: the server's own once-ever rule still holds after sign-in.
    }
  };
  return create<ExitOfferDeviceState>()((set) => ({
    shown: read('shown'),
    toRecord: read('toRecord'),
    markShown: () => {
      write('shown', true);
      write('toRecord', true);
      set({ shown: true, toRecord: true });
    },
    recorded: () => {
      write('toRecord', false);
      set({ toRecord: false });
    },
  }));
}

export const useExitOfferDevice = createExitOfferDeviceStore(createKeyValueStorage('exitOffer:'));
