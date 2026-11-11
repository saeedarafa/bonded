import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useSession } from '@/features/auth/session';
import { queryKeys } from '@/lib/queryKeys';

import { hrefForPush, isOnTarget, parsePushData } from './links';
import { usePushRoute } from './store';

/**
 * Push handling at the root (MOB-15): taps (warm and cold start) and pushes that arrive while the
 * app is open. Nothing here logs or tracks the title or body (they can hold a message preview).
 */

/**
 * In the foreground the system banner stays hidden and our own banner (37) shows instead; the push
 * still lands in the notification list. Call once at startup, before any push can arrive.
 */
export function configureForegroundPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
}

/** Ids of responses already routed, so the cold-start response and the listener can't both fire. */
const handled = new Set<string>();

/** Tests only. */
export function resetHandledPushes(): void {
  handled.clear();
}

export function openPushResponse(response: Notifications.NotificationResponse): void {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const id = response.notification.request.identifier;
  if (handled.has(id)) return;
  handled.add(id);
  const data = parsePushData(response.notification.request.content.data);
  usePushRoute.getState().open(hrefForPush(data));
}

/**
 * The app can take a pushed route once the person is signed in and the front door (`/`) has sent
 * them on. Signed out, the route waits through sign-in (deeplinks.json: "08, then the question").
 */
const NOT_READY = ['/', '/welcome', '/sign-in'];
const NOT_READY_PREFIXES = ['/story/', '/quiz/', '/join/', '/j/'];

export function canRouteFrom(pathname: string): boolean {
  if (NOT_READY.includes(pathname)) return false;
  return !NOT_READY_PREFIXES.some((p) => pathname.startsWith(p));
}

export function usePushRouting(): void {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();
  const qc = useQueryClient();
  const pending = usePushRoute((s) => s.pending);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Taps: the one that launched the app (cold start), then every later one (warm).
  useEffect(() => {
    const launch = Notifications.getLastNotificationResponse();
    if (launch) {
      openPushResponse(launch);
      Notifications.clearLastNotificationResponse();
    }
    const tapped = Notifications.addNotificationResponseReceivedListener(openPushResponse);
    return () => tapped.remove();
  }, []);

  // Arrivals in the foreground: refresh what the push is about, then show the in-app banner
  // unless the person is already on that screen.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const { content, identifier } = notification.request;
      const data = parsePushData(content.data);
      void qc.invalidateQueries({ queryKey: queryKeys.today.all });
      if (data.type === 'thread_activity') {
        void qc.invalidateQueries({ queryKey: queryKeys.thread.all });
      }
      // D48: a partner's little things; Today acts them out (24d) from the refetched rows.
      if (data.type === 'little_thing') {
        void qc.invalidateQueries({ queryKey: queryKeys.littleThings.all });
      }
      // The partner just bought Premium (D29): the server entitlement covers us now (MOB-19).
      if (data.type === 'partner_premium') {
        void qc.invalidateQueries({ queryKey: queryKeys.entitlements() });
      }
      const href = hrefForPush(data);
      if (isOnTarget(pathnameRef.current, href)) return;
      usePushRoute.getState().showBanner({
        id: identifier,
        title: content.title ?? '',
        body: content.body ?? '',
        href,
      });
    });
    return () => received.remove();
  }, [qc]);

  useEffect(() => {
    if (!pending || status !== 'signedIn' || !canRouteFrom(pathname)) return;
    usePushRoute.getState().consume();
    router.push(pending);
  }, [pending, status, pathname, router]);
}
