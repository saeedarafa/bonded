import { create } from 'zustand';

import type { PushHref } from './links';

/** A push that arrived while the app was open (37, in-app). Text lives in memory only. */
export type PushBannerItem = { id: string; title: string; body: string; href: PushHref };

type PushRouteState = {
  /** Where a tapped push wants to go, until the app is ready (signed in, past the front door). */
  pending: PushHref | null;
  banner: PushBannerItem | null;
  open: (href: PushHref) => void;
  consume: () => void;
  showBanner: (item: PushBannerItem) => void;
  hideBanner: () => void;
};

/** UI-only state (Zustand). Wiped with the app process; nothing is persisted. */
export const usePushRoute = create<PushRouteState>((set) => ({
  pending: null,
  banner: null,
  open: (href) => set({ pending: href }),
  consume: () => set({ pending: null }),
  showBanner: (banner) => set({ banner }),
  hideBanner: () => set({ banner: null }),
}));
