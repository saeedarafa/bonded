import type { CancelOffer } from './purchases';

/**
 * MOB-84 (D61): the cancel offer Us → Manage subscription already cleared (store offer +
 * `open_exit_offer('cancel')`), handed to the offer screen so the server is asked only once.
 * The push path (`bonded://subscription/offer`) finds nothing here and asks itself. A native
 * product can't travel in route params, hence this one-slot holder (memory only, never stored).
 */
let held: CancelOffer | null = null;

export function holdCancelOffer(offer: CancelOffer): void {
  held = offer;
}

export function peekHeldCancelOffer(): CancelOffer | null {
  return held;
}

export function clearHeldCancelOffer(): void {
  held = null;
}
