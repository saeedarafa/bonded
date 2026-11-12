import { usePathname, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { create } from 'zustand';

import { getAnalyticsAccount } from '@/features/auth/api';
import type { SessionState } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { useStreak } from '@/features/daily/hooks';
import { noteOnboardingStarted } from '@/features/onboarding/analytics';
import { isNewAccount } from '@/features/onboarding/frontDoor';
import { purchasePending, trackPremiumConfirmed } from '@/features/premium/analytics';
import { usePremium } from '@/features/premium/hooks';
import { getPermission } from '@/features/push/device';
import { ritualTimeAnalyticsId } from '@/features/push/ritual';
import { useNotificationPrefs } from '@/features/settings/hooks';
import {
  GOAL_IDS,
  STAGE_IDS,
  analyticsEnabled,
  identifyUser,
  isOptedOut,
  onceOnDevice,
  optInToAnalytics,
  optOutOfAnalytics,
  resetUser,
  setPersonProperties,
  setSuperProperties,
  track,
  type EventName,
  type PersonProperties,
} from '@/lib/analytics';
import { analyticsEnv } from '@/lib/env';

import { consumeAccountDeleted } from './events';
import {
  beginOpen,
  cancelOpen,
  claimColdStart,
  deepLinkKind,
  noteOpenSource,
  takeOpenSource,
} from './appOpen';
import { coupleRole, notePushPermission, trackPaired } from './lifecycle';
import { milestoneNumber, onboardingStep, screenView, VIEW_EVENTS } from './screens';

/**
 * Root analytics wiring (MOB-24, D54): identity, the §2 properties on every event, `app_opened`,
 * screen views and onboarding step views. Does nothing (and fetches nothing extra) when there is
 * no PostHog key or the person switched "Share usage data" off (40, MOB-24b).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** ANALYTICS §3.1: a new session is a cold start or a return after 30 min (review.ts rule). */
export const APP_OPEN_GAP_MS = 30 * 60 * 1000;
/** How long `app_opened` waits for a push tap or a link to say it opened the app. */
export const OPEN_SOURCE_WAIT_MS = 1500;

export function wholeDays(
  fromIso: string | null | undefined,
  now = Date.now(),
): number | undefined {
  const from = Date.parse(fromIso ?? '');
  if (Number.isNaN(from)) return undefined;
  return Math.max(0, Math.floor((now - from) / DAY_MS));
}

// ---------- "Share usage data" (40, MOB-24b) ----------

type Consent = { sharing: boolean; setSharing: (next: boolean) => Promise<void> };

export const useAnalyticsConsent = create<Consent>((set) => ({
  sharing: !isOptedOut(),
  setSharing: async (next) => {
    set({ sharing: next });
    if (next) await optInToAnalytics();
    else await optOutOfAnalytics();
  },
}));

function useAppOpened(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      beginOpen();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => track('app_opened', takeOpenSource()), OPEN_SOURCE_WAIT_MS);
    };
    if (claimColdStart()) {
      open();
      void Linking.getInitialURL()
        .then((url) => {
          if (!url) return;
          track('deep_link_opened', deepLinkKind(url));
          noteOpenSource({ source: 'link' });
        })
        .catch(() => {});
    }
    const links = Linking.addEventListener('url', ({ url }) => {
      track('deep_link_opened', deepLinkKind(url));
      noteOpenSource({ source: 'link' });
    });
    let backgroundAt: number | null = null;
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt = Date.now();
      else if (state === 'active' && backgroundAt !== null) {
        if (Date.now() - backgroundAt >= APP_OPEN_GAP_MS) open();
        backgroundAt = null;
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      cancelOpen();
      links.remove();
      appState.remove();
    };
  }, [enabled]);
}

// ---------- Screen views ----------

function useScreenViews(enabled: boolean) {
  const segments = useSegments();
  const pathname = usePathname();
  // Segments never contain '/', so the joined string is a stable effect key.
  const route = segments.join('/');

  useEffect(() => {
    if (!enabled) return;
    const view = screenView(route ? route.split('/') : [], pathname);
    track('screen_viewed', view);
    const implied = view.screen_id ? VIEW_EVENTS[view.screen_id] : undefined;
    if (implied) (track as (event: EventName) => void)(implied);
    const n = view.screen_id === '25' ? milestoneNumber(pathname) : null;
    if (n !== null) track('milestone_viewed', { n });
    const step = onboardingStep(pathname);
    if (!step) return;
    if (onceOnDevice('onboarding_started')) {
      track('onboarding_started', { resumed: step.step !== '01' });
      noteOnboardingStarted();
    }
    track('onboarding_step_viewed', step);
  }, [enabled, route, pathname]);
}

// ---------- Identity and §2 properties ----------

function useDeviceProperties(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const config = Constants.expoConfig;
    setSuperProperties({
      app_version: config?.version,
      build:
        String(
          Platform.OS === 'ios'
            ? (config?.ios?.buildNumber ?? '')
            : (config?.android?.versionCode ?? ''),
        ) || undefined,
      platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : undefined,
      os_version: String(Platform.Version),
      is_test_account: analyticsEnv().testBuild,
    });
  }, [enabled]);
}

/** Returns the account's sign-up time once read (for `paired.hours_from_signup`). */
function useIdentity({ status, userId }: SessionState, enabled: boolean): string | null {
  const previous = useRef<SessionState['status']>('loading');
  const identified = useRef<string | null>(null);
  const [signedUp, setSignedUp] = useState<{ userId: string; at: string } | null>(null);

  useEffect(() => {
    if (!enabled) {
      identified.current = null;
      return;
    }
    if (status === 'loading') return;
    const before = previous.current;
    previous.current = status;
    if (status === 'signedOut') {
      if (identified.current) {
        // After `account_deleted` the person did not sign out: the account is gone, and the id
        // was already reset before that event (events.ts).
        if (!consumeAccountDeleted()) {
          track('signed_out');
          resetUser();
        }
        identified.current = null;
      }
      setSuperProperties({
        signed_in: false,
        is_test_account: analyticsEnv().testBuild,
        couple_state: undefined,
        couple_id: undefined,
        is_premium: undefined,
        days_since_signup: undefined,
        days_since_paired: undefined,
        streak: undefined,
      });
      return;
    }
    if (identified.current === userId) return;
    identified.current = userId;
    identifyUser(userId);
    setSuperProperties({ signed_in: true });
    let alive = true;
    void getAnalyticsAccount()
      .then((account) => {
        if (!alive || !account) return;
        setSuperProperties({
          is_test_account: analyticsEnv().testBuild || account.testAccount,
          days_since_signup: wholeDays(account.created_at),
        });
        const person: PersonProperties = {};
        if (account.method) person.signup_method = account.method;
        if (account.created_at) {
          person.signed_up_at = account.created_at;
          setSignedUp({ userId, at: account.created_at });
        }
        setPersonProperties(person);
        // A sign-in during this run (not the stored session on a cold start).
        if (before === 'signedOut' && account.method) {
          track(isNewAccount(account) ? 'signed_up' : 'signed_in', { method: account.method });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, status, userId]);
  return signedUp && signedUp.userId === userId ? signedUp.at : null;
}

const STAGES = new Set<string>(STAGE_IDS);
const GOALS = new Set<string>(GOAL_IDS);

function useCoupleProperties(
  { status, userId }: SessionState,
  enabled: boolean,
  signedUpAt: string | null,
) {
  const on = enabled && status === 'signedIn';
  const couple = useActiveCouple({ enabled: on });
  const prefs = useNotificationPrefs({ enabled: on });
  const ritual = prefs.data?.ritual_time;
  const premium = usePremium({ enabled: on });
  const paired = isCoupleComplete(couple.data);
  const streak = useStreak({ enabled: on && paired });
  const c = couple.data;
  const isPremium = premium.status === 'ready' ? premium.isPremium : undefined;
  const current = streak.data?.current;
  const role = paired ? coupleRole(couple.data, userId) : null;

  useEffect(() => {
    if (!on || c === undefined) return;
    setSuperProperties({
      couple_state: c ? (paired ? 'paired' : 'solo') : 'none',
      couple_id: c?.id,
      days_since_paired: paired ? wholeDays(c?.paired_at) : undefined,
      is_premium: isPremium,
      streak: paired ? current : undefined,
    });
    const person: PersonProperties = {};
    if (c?.paired_at) person.paired_at = c.paired_at;
    if (isPremium !== undefined) person.is_premium = isPremium;
    // §3.9: the server flipped to premium after a store purchase on this phone.
    if (isPremium === true) trackPremiumConfirmed();
    // `plan` is set from the purchase itself; without one in flight, not premium means none.
    if (isPremium === false && !purchasePending()) person.plan = 'none';
    if (c?.stage && STAGES.has(c.stage)) person.stage = c.stage as PersonProperties['stage'];
    if (Array.isArray(c?.goals)) {
      person.goals = c.goals.filter((g) => GOALS.has(g)) as PersonProperties['goals'];
    }
    if (role) person.role = role;
    setPersonProperties(person);
    // §3.4: both phones, once per couple, when it becomes paired.
    if (paired && c) trackPaired({ coupleId: c.id, pairedAt: c.paired_at, role, signedUpAt });
  }, [on, c, paired, isPremium, current, role, signedUpAt]);

  // §2 person property `ritual_time`: the preset or `other`, never the exact time.
  useEffect(() => {
    if (on && ritual) setPersonProperties({ ritual_time: ritualTimeAnalyticsId(ritual) });
  }, [on, ritual]);
}

/**
 * §2 `push_enabled` (the OS lets Bonded notify) and §3.8 `push_permission_changed`, read on every
 * app open (start, and back to the foreground).
 */
function usePushPermission({ status }: SessionState, enabled: boolean) {
  const signedIn = status === 'signedIn';
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const read = () => {
      void getPermission()
        .then((state) => {
          if (!alive) return;
          notePushPermission(state);
          if (signedIn) setPersonProperties({ push_enabled: state === 'granted' });
        })
        .catch(() => {});
    };
    read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [enabled, signedIn]);
}

/** Root layout: call once, inside the session provider and the navigator. */
export function useAnalytics(session: SessionState): void {
  const sharing = useAnalyticsConsent((s) => s.sharing);
  const enabled = sharing && analyticsEnabled();
  useDeviceProperties(enabled);
  const signedUpAt = useIdentity(session, enabled);
  useCoupleProperties(session, enabled, signedUpAt);
  usePushPermission(session, enabled);
  useAppOpened(enabled);
  useScreenViews(enabled);
}
