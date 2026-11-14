import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { SessionState } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';

import { registerWidgetRefresh, unregisterWidgetRefresh } from './backgroundTask';
import { canHoldWidgetToken, forgetWidgetToken, refreshWidgetToken } from './tokens';

/**
 * Keeps this phone's widget token in step with the session and the couple (MOB-77, SEC-21):
 * - signed in with a complete couple: mint when less than 24 h is left, now and on every
 *   foreground, and turn on the background refresh (MOB-78b) when this build has a token reader;
 * - signed out (also a session that ended elsewhere), no couple, a solo or an ended couple: delete
 *   the token on this phone, blank the widgets and turn the background refresh off. The server already refuses the old token; this
 *   makes sure the widget has nothing left to send.
 * Like `useWidgetSync` it only watches the cache (the couple query is disabled here).
 */
export function useWidgetToken(session: SessionState): void {
  const { status } = session;
  const couple = useActiveCouple({ enabled: false });
  const loaded = couple.data !== undefined;
  const paired = isCoupleComplete(couple.data);

  const mode: 'wait' | 'keep' | 'forget' =
    status === 'loading'
      ? 'wait'
      : status !== 'signedIn'
        ? 'forget'
        : !loaded
          ? 'wait'
          : paired
            ? 'keep'
            : 'forget';

  useEffect(() => {
    if (mode === 'forget') {
      void forgetWidgetToken();
      return undefined;
    }
    if (mode !== 'keep') return undefined;
    void refreshWidgetToken();
    if (canHoldWidgetToken()) void registerWidgetRefresh();
    else void unregisterWidgetRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshWidgetToken();
    });
    return () => sub.remove();
  }, [mode]);
}
