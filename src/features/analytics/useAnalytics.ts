import { usePathname, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { create } from 'zustand';

import { getAnalyticsAccount } from '@/features/auth/api';
import type { SessionState } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { useStreak } from '@/features/daily/hooks';
import { isNewAccount } from '@/features/onboarding/frontDoor';
import { usePremium } from '@/features/premium/hooks';
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
  type EventProps,
  type PersonProperties,
} from '@/lib/analytics';
import { analyticsEnv } from '@/lib/env';

import { onboardingStep, screenView } from './screens';

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

// ---------- app_opened source ----------

type OpenSource = Pick<EventProps<'app_opened'>, 'source' | 'push_type'>;
let waitingForSource = false;
let pendingSource: OpenSource | null = null;
let coldStartTracked = false;

/** A push tap or a link that opened the app: `app_opened` names it as the source. */
export function noteOpenSource(source: OpenSource): void {
  if (waitingForSource && pendingSource?.source !== 'push') pendingSource = source;
}

/** Tests: forget the cold start and any pending source. */
export function resetAppOpenForTests(): void {
  waitingForSource = false;
  pendingSource = null;
  coldStartTracked = false;
}

/** `bonded://j/…`, `https://trybonded.com/j/…`, `…/auth/callback`: the kind only, never the URL. */
export function deepLinkKind(url: string): EventProps<'deep_link_opened'> {
  const path = url.replace(/^[a-z]+:\/\/(?:[^/]*\/)?/i, '/').split(/[?#]/)[0] ?? '';
  if (/^\/+j\/[^/]+\/?$/.test(path)) return { kind: 'invite', valid: true };
  if (/^\/+auth\/callback\/?$/.test(path)) return { kind: 'auth', valid: true };
  return { kind: 'other', valid: false };
}

function useAppOpened(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      waitingForSource = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const source = pendingSource ?? { source: 'icon' as const };
        waitingForSource = false;
        pendingSource = null;
        track('app_opened', source);
      }, OPEN_SOURCE_WAIT_MS);
    };
    if (!coldStartTracked) {
      coldStartTracked = true;
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
      waitingForSource = false;
      links.remove();
      appState.remove();
    };
  }, [enabled]);
}

// ---------- Screen views ----------

function useScreenViews(enabled: boolean) {
  const segments = useSegments();
  const pathname = usePathname();
  const route = segments.join('/');
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  useEffect(() => {
    if (!enabled) return;
    track('screen_viewed', screenView(segmentsRef.current, pathname));
    const step = onboardingStep(pathname);
    if (!step) return;
    if (onceOnDevice('onboarding_started')) {
      track('onboarding_started', { resumed: step.step !== '01' });
    }
    track('onboarding_step_viewed', step);
    if (step.step === 'P2') track('plan_viewed');
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

function useIdentity({ status, userId }: SessionState, enabled: boolean) {
  const previous = useRef<SessionState['status']>('loading');
  const identified = useRef<string | null>(null);

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
        track('signed_out');
        resetUser();
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
        if (account.created_at) person.signed_up_at = account.created_at;
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
}

const STAGES = new Set<string>(STAGE_IDS);
const GOALS = new Set<string>(GOAL_IDS);

function useCoupleProperties({ status }: SessionState, enabled: boolean) {
  const on = enabled && status === 'signedIn';
  const couple = useActiveCouple({ enabled: on });
  const premium = usePremium({ enabled: on });
  const paired = isCoupleComplete(couple.data);
  const streak = useStreak({ enabled: on && paired });
  const c = couple.data;
  const isPremium = premium.status === 'ready' ? premium.isPremium : undefined;
  const current = streak.data?.current;

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
    if (c?.stage && STAGES.has(c.stage)) person.stage = c.stage as PersonProperties['stage'];
    if (c) person.goals = c.goals.filter((g) => GOALS.has(g)) as PersonProperties['goals'];
    setPersonProperties(person);
  }, [on, c, paired, isPremium, current]);
}

/** Root layout: call once, inside the session provider and the navigator. */
export function useAnalytics(session: SessionState): void {
  const sharing = useAnalyticsConsent((s) => s.sharing);
  const enabled = sharing && analyticsEnabled();
  useDeviceProperties(enabled);
  useIdentity(session, enabled);
  useCoupleProperties(session, enabled);
  useAppOpened(enabled);
  useScreenViews(enabled);
}
