import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { SessionState } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { usePremium } from '@/features/premium/hooks';

import { requestWidgetReload } from './reload';

/**
 * MOB-78c (QA-49b): redraw the home-screen widgets when the app comes to the foreground and when
 * the Premium or couple state the app holds changes (sign-in/out, pairing, unpair, lapse, renewal).
 * The Premium widgets then ask the server for `state` again, so a lapsed plan shows the locked
 * preview without a tap. Like `useWidgetSync` it only watches the cache (queries disabled here).
 * The reload carries no data: the widgets read the snapshot and the server themselves.
 */
export function useWidgetReload(session: SessionState): void {
  const { status } = session;
  const couple = useActiveCouple({ enabled: false });
  const premium = usePremium({ enabled: false });
  const coupleId = couple.data?.id ?? null;
  const paired = isCoupleComplete(couple.data);
  const isPremium = premium.status === 'ready' ? premium.isPremium : null;

  const key =
    status === 'loading'
      ? null
      : JSON.stringify([status, couple.data === undefined ? '?' : coupleId, paired, isPremium]);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (key === null || key === last.current) return;
    last.current = key;
    requestWidgetReload('state');
  }, [key]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestWidgetReload('foreground');
    });
    return () => sub.remove();
  }, []);
}
