import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import type * as QueryModule from '@tanstack/react-query';
import type * as ReactModule from 'react';
import { AccessibilityInfo, Keyboard, Linking, Share, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useDrafts } from '@/lib/drafts';
import { clearOutbox, useOutbox } from '@/lib/outbox';
import { usePendingSetup } from '@/features/onboarding/pendingSetup';
import { createOnboardingStore, useOnboarding } from '@/features/onboarding/store';
import { getRevealedQuestion } from '@/features/daily/api';
import { localDateKey } from '@/features/daily/today';
import { acceptInvite, invitePreview } from '@/features/pairing/api';
import { useMyInvite } from '@/features/pairing/hooks';
import { usePendingJoin } from '@/features/pairing/joinRequest';
import { useSeenBadges } from '@/features/badges/seen';
import { useEndedSeen } from '@/features/settings/partnerLeft';
import { toServerOffer, useOfferShown } from '@/features/premium/offers';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import { setPushStorage } from '@/features/push/registration';
import { setReviewStorage } from '@/features/review/review';
import { declineSoftAsk, setSoftAskStorage } from '@/features/push/softAsk';
import { AppError } from '@/lib/errors';
import type * as RealtimeModule from '@/lib/realtime';
import { cacheStorage, createKeyValueStorage, secureStore } from '@/lib/storage';
import { memoryStorage } from '@/test/memoryStorage';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { TITLE_MAX_FONT_SCALE } from '@/ui';

// The auth gate reads the session through `features/auth/api` and the couple through
// `features/couple/api` (the only Supabase touchpoints), so both are controlled here.
let mockUser: { userId: string } | null = null;
let mockSessionListener: ((u: { userId: string } | null) => void) | null = null;
const mockCompleteEmailCallback = jest.fn();
const SOLO = {
  id: 'couple-1',
  couple_members: [{ user_id: 'u1', left_at: null }],
  // Created today: 11 shows "Day 1" (#36).
  created_at: new Date().toISOString(),
  paired_at: null,
  timezone: null,
};
let mockCouple: object | null = SOLO;
jest.mock('@/features/auth/api', () => ({
  completeEmailAuthCallback: (args: unknown) => mockCompleteEmailCallback(args),
  subscribeToSession: (listener: (u: { userId: string } | null) => void) => {
    mockSessionListener = listener;
    listener(mockUser);
    return () => undefined;
  },
  isAppleSignInAvailable: () => Promise.resolve(false),
  // MOB-40: J4's email code signs in as the joiner (u2).
  sendEmailCode: () => Promise.resolve(),
  verifyEmailCode: () => {
    mockUser = { userId: 'u2' };
    mockSessionListener?.(mockUser);
    return Promise.resolve();
  },
  getAccountTimes: () => Promise.resolve(mockAccountTimes),
  // MOB-18: 40's "Sign out" ends the session like the real one.
  signOut: () => {
    mockUser = null;
    mockSessionListener?.(null);
    return Promise.resolve();
  },
}));
// D40: an account that signed in before (created long before this sign-in) unless a test says so.
const OLD_ACCOUNT = {
  created_at: '2026-01-01T10:00:00Z',
  last_sign_in_at: '2026-11-01T10:00:00Z',
};
let mockAccountTimes: { created_at: string; last_sign_in_at: string | null } | null = OLD_ACCOUNT;
// #93: how long `getActiveCouple` takes (0 = at once); a phone waits for the network.
let mockCoupleDelayMs = 0;
// #112 (MOB-44): hold `getActiveCouple` until a test opens the gate, or make it fail.
let mockCoupleGate: Promise<void> | null = null;
let mockCoupleError: Error | null = null;
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: async () => {
    if (mockCoupleGate) await mockCoupleGate;
    if (mockCoupleError) throw mockCoupleError;
    return mockCoupleDelayMs
      ? new Promise((resolve) => setTimeout(() => resolve(mockCouple), mockCoupleDelayMs))
      : mockCouple;
  },
  createCouple: (input: object) => {
    mockCreateCouple(input);
    // MOB-61b: the account is already in a couple (the server's ALREADY_PAIRED).
    if (mockAlreadyPaired) {
      mockCouple = mockAlreadyPaired;
      return Promise.reject(mockAlreadyPairedError());
    }
    mockCouple = { id: 'couple-1', couple_members: [{ user_id: 'u1', left_at: null }] };
    return Promise.resolve('couple-1');
  },
  unpair: () => mockUnpair(),
}));
// MOB-61b: what `create_couple` was sent, and a couple to answer ALREADY_PAIRED with.
const mockCreateCouple = jest.fn<void, [object]>();
let mockAlreadyPaired: object | null = null;
const mockAlreadyPairedError = () => new AppError('ALREADY_PAIRED', 'Already paired.');
// MOB-18: `unpair()` (42); tests script it.
const mockUnpair = jest.fn<Promise<void>, []>(() => Promise.resolve());
// MOB-18 settings: notification prefs, the ended couple for 58, `delete-account`.
let mockEnded: object | null = null;
let mockPrefs: object | null = null;
const mockSavePrefs = jest.fn<Promise<void>, [string, object]>(() => Promise.resolve());
const mockDeleteAccount = jest.fn<Promise<void>, []>(() => Promise.resolve());
const mockProfileName = jest.fn<Promise<string | null>, [string]>(() => Promise.resolve('Sam'));
jest.mock('@/features/settings/api', () => ({
  ...jest.requireActual('@/features/settings/api'),
  getNotificationPrefs: () => Promise.resolve(mockPrefs),
  saveNotificationPrefs: (uid: string, patch: object) => mockSavePrefs(uid, patch),
  updateCoupleSettings: () => Promise.resolve(),
  getLatestEndedCouple: () => Promise.resolve(mockEnded),
  getProfileName: (id: string) => mockProfileName(id),
  deleteAccount: () => mockDeleteAccount(),
}));
// After a successful delete the real wipe signs out; here the session listener does it.
const mockWipe = jest.fn(() => {
  mockUser = null;
  mockSessionListener?.(null);
  return Promise.resolve();
});
jest.mock('@/features/settings/localData', () => ({ wipeLocalAccount: () => mockWipe() }));
// MOB-28: the key dates written by the setup after create_couple.
const mockUpsertKeyDates = jest.fn<Promise<void>, [object[]]>(() => Promise.resolve());
jest.mock('@/features/keyDates/api', () => ({
  upsertKeyDates: (rows: object[]) => mockUpsertKeyDates(rows),
}));
// MOB-61: the after-sign-in writes of T1 (day-1 answer) and N (ritual time), recorded in order.
const mockSetupCalls: string[] = [];
const mockSaveFirstAnswer = jest.fn<Promise<void>, [object]>(() => {
  mockSetupCalls.push('answer');
  return Promise.resolve();
});
jest.mock('@/features/onboarding/api', () => ({
  upsertOnboardingAnswers: () => {
    mockSetupCalls.push('onboarding_answers');
    return Promise.resolve();
  },
  getDailyQuestionId: () => {
    mockSetupCalls.push('get_daily_question');
    return Promise.resolve('cq-day1');
  },
  saveFirstAnswer: (input: object) => mockSaveFirstAnswer(input),
}));
const mockSaveRitualTime = jest.fn<Promise<void>, [string, string]>(() => {
  mockSetupCalls.push('ritual_time');
  return Promise.resolve();
});
jest.mock('@/features/push/api', () => ({
  ...jest.requireActual<object>('@/features/push/api'),
  saveRitualTime: (userId: string, time: string) => mockSaveRitualTime(userId, time),
}));
// D36: the open invite in `pair_invites` (null = none) and the calls that make codes and links.
let mockOpenInvite: object | null = null;
const mockCreateInvite = jest.fn(() => {
  mockOpenInvite = { code: '4827', expiresAt: '2999-01-01T00:00:00Z', acceptedAt: null };
  return Promise.resolve({ code: '4827', expiresAt: '2999-01-01T00:00:00Z', token: 'tok' });
});
const mockInviteLink = jest.fn<Promise<object | null>, []>(() => Promise.resolve(null));
// D37 entries: on since BE-26 + MOB-32; the flag stays as a kill switch, so one test turns it off.
const mockFlags = { JOIN_FROM_SOLO_ENABLED: true };
jest.mock('@/features/pairing/flags', () => mockFlags);
// BE-26: the inviter's pending list, the joiner's own row, and approve/decline.
const FUTURE = '2999-01-01T00:00:00Z';
let mockPendingRequests: object[] = [];
let mockMyRequest: object | null = { status: 'pending', expiresAt: FUTURE };
const mockApproveJoin = jest.fn<Promise<string | null>, [string]>();
const mockDeclineJoin = jest.fn<Promise<void>, [string]>();
jest.mock('@/features/pairing/api', () => ({
  createInvite: () => mockCreateInvite(),
  getOpenInvite: () => Promise.resolve(mockOpenInvite),
  inviteLink: () => mockInviteLink(),
  invitePreview: jest.fn(),
  acceptInvite: jest.fn(),
  getPendingJoinRequests: () => Promise.resolve(mockPendingRequests),
  getMyJoinRequest: () => Promise.resolve(mockMyRequest),
  approveJoin: (id: string) => mockApproveJoin(id),
  declineJoin: (id: string) => mockDeclineJoin(id),
}));
jest.mock('@/features/profile/api', () => ({
  getCoupleProfiles: () =>
    Promise.resolve([
      { id: 'u1', display_name: 'Alex', avatar_url: null },
      { id: 'u2', display_name: 'Sam', avatar_url: null },
    ]),
  updateMyProfile: () => Promise.resolve(),
  deviceTimezone: () => 'Europe/Berlin',
}));
// Server entitlements (MOB-19): none by default, so nobody is premium.
let mockEntitlements: { user_id: string; is_active: boolean; expires_at: string | null }[] = [];
// The day-3 gift (MOB-64, BE-47): none by default; tests script `mockGetOffer` with the RPC's JSON.
const mockNoOffer = () => Promise.resolve(toServerOffer({ eligible: false, expires_at: null }));
const mockGetOffer = jest.fn((_kind: string) => mockNoOffer());
const mockOpenOffer = jest.fn((_kind: string) => mockNoOffer());
// `claim_offer_screen` (one full-screen offer per person per day): free unless a test says not.
const mockClaimOfferScreen = jest.fn((_screen: string) => Promise.resolve(true));
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => Promise.resolve(mockEntitlements),
  getOffer: (kind: string) => mockGetOffer(kind),
  openOffer: (kind: string) => mockOpenOffer(kind),
  claimOfferScreen: (screen: string) => mockClaimOfferScreen(screen),
}));
// `get_streak()` row (MOB-41 tests set it); null = no streak yet.
let mockStreak: object | null = null;
// `use_streak_saver()` (MOB-21): tests script it.
const mockClaimSaver = jest.fn<Promise<object | null>, []>();
// MOB-49: answers written through the flow (any couple question).
const mockSaveAnswer = jest.fn<Promise<void>, [object]>(() => Promise.resolve());
const mockSetAnswerReaction = jest.fn((_input: unknown) => Promise.resolve());
jest.mock('@/features/daily/api', () => ({
  NUDGE_AVAILABLE: false,
  getTodayQuestion: () =>
    Promise.resolve({ id: 'cq-1', answerCount: 0, question: 'What made you smile?', answers: [] }),
  getStreak: () => Promise.resolve(mockStreak),
  claimStreakSaver: () => mockClaimSaver(),
  sendNudge: () => Promise.resolve(),
  getRevealedQuestion: jest.fn(),
  saveAnswer: (input: object) => mockSaveAnswer(input),
  setAnswerReaction: (input: unknown) => mockSetAnswerReaction(input),
  removeAnswerReaction: () => Promise.resolve(),
}));
// No websocket in Jest: the real `subscribeToCouple` runs against a fake client, so a test can
// fire a postgres change (`mockRealtime.emit`) and see the screen react through the invalidation.
type MockChange = { new?: Record<string, unknown>; old?: Record<string, unknown> };
const mockRealtime = {
  handlers: new Map<string, (payload: MockChange) => void>(),
  client: {
    channel() {
      const channel = {
        state: 'joined',
        on(type: string, filter: { table?: string }, cb: (payload: MockChange) => void) {
          if (type === 'postgres_changes' && filter.table)
            mockRealtime.handlers.set(filter.table, cb);
          return channel;
        },
        subscribe(cb: (status: string) => void) {
          cb('SUBSCRIBED');
          return channel;
        },
        send: () => Promise.resolve('ok'),
      };
      return channel;
    },
    removeChannel: () => {
      mockRealtime.handlers.clear();
      return Promise.resolve('ok');
    },
  },
  emit(table: string, payload: MockChange) {
    const handler = mockRealtime.handlers.get(table);
    if (!handler) throw new Error(`no realtime subscription for ${table}`);
    handler(payload);
  },
};
jest.mock('@/lib/useCoupleRealtime', () => {
  const { useEffect } = jest.requireActual<typeof ReactModule>('react');
  const { useQueryClient } = jest.requireActual<typeof QueryModule>('@tanstack/react-query');
  const { subscribeToCouple } = jest.requireActual<typeof RealtimeModule>('@/lib/realtime');
  return {
    useCoupleRealtime: (coupleId: string | null | undefined) => {
      const queryClient = useQueryClient();
      useEffect(() => {
        if (!coupleId) return undefined;
        return subscribeToCouple(mockRealtime.client as never, queryClient, coupleId);
      }, [coupleId, queryClient]);
    },
    sendTypingSignal: () => undefined,
  };
});
jest.mock('@/lib/useJoinRequestRealtime', () => {
  const { useEffect } = jest.requireActual<typeof ReactModule>('react');
  const { useQueryClient } = jest.requireActual<typeof QueryModule>('@tanstack/react-query');
  const { subscribeToJoinRequest } = jest.requireActual<typeof RealtimeModule>('@/lib/realtime');
  return {
    useJoinRequestRealtime: (requestId: string | null | undefined) => {
      const queryClient = useQueryClient();
      useEffect(() => {
        if (!requestId) return undefined;
        return subscribeToJoinRequest(mockRealtime.client as never, queryClient, requestId);
      }, [requestId, queryClient]);
    },
  };
});
// #66: force the short-screen-at-large-text layout (AX5 on an iPhone SE) per test.
let mockCramped = false;
jest.mock('@/ui/useCramped', () => ({
  ...jest.requireActual<object>('@/ui/useCramped'),
  useCramped: () => mockCramped,
}));
// History (MOB-16): nothing unless a test sets it.
let mockUnreadCounts: Record<string, number> = {};
let mockHistoryRows: object[] = [];
let mockHistoryDays: object[] = [];
let mockFirstDay: string | null = null;
let mockHistoryDetail: object | null = null;
let mockLastMessage: object | null = null;
const mockGetHistoryPage = jest.fn(() => Promise.resolve(mockHistoryRows));
const mockGetLastMessage = jest.fn(() => Promise.resolve(mockLastMessage));
jest.mock('@/features/history/api', () => ({
  HISTORY_PAGE_SIZE: 20,
  getHistoryMonth: () => Promise.resolve(mockHistoryDays),
  getFirstHistoryDay: () => Promise.resolve(mockFirstDay),
  getHistoryPage: () => mockGetHistoryPage(),
  getHistoryDetail: () => Promise.resolve(mockHistoryDetail),
  getLastMessage: () => mockGetLastMessage(),
  getEndedHistoryPage: (coupleId: string, page: number) => mockGetEndedPage(coupleId, page),
  getEndedQuestion: (coupleId: string, id: string) => mockGetEndedQuestion(coupleId, id),
}));
// 31 (MOB-21 part 2): a free week by default; its own screen test covers the states.
jest.mock('@/features/recap/api', () => ({
  getWeeklyRecap: () =>
    Promise.resolve({
      daysTogether: 0,
      replies: null,
      reactions: null,
      mostLovedAnswerId: null,
      isFull: false,
    }),
  getLovedAnswer: () => Promise.resolve(null),
  getAnswerBody: () => Promise.resolve(null),
}));
// MOB-50: the ended couple's archive (D08); nothing unless a test sets it.
let mockEndedRows: { id: string }[] = [];
const mockGetEndedPage = jest.fn((_coupleId: string, _page: number) =>
  Promise.resolve(mockEndedRows),
);
const mockGetEndedQuestion = jest.fn((_coupleId: string, id: string) =>
  Promise.resolve(mockEndedRows.find((r) => r.id === id) ?? null),
);
// Badge awards (MOB-17): none unless a test sets them.
let mockAwards: object[] = [];
jest.mock('@/features/badges/api', () => ({
  getBadgeCatalogue: () =>
    Promise.resolve(
      [1, 3, 7, 14, 21, 30, 50, 100, 365].map((n) => ({
        slug: `streak-${n}`,
        kind: 'streak',
        owner: 'shared',
        threshold: n,
        title: `${n} days`,
        description: 'd',
        priority: 'P0',
        status: 'placeholder',
      })),
    ),
  getBadgeAwards: () => Promise.resolve(mockAwards),
}));
// Packs (MOB-20): one premium pack with three questions; tests script `start_pack_question`.
const mockStartPackQuestion = jest.fn<Promise<string>, [string]>();
// D51: question id -> couple_questions id of the pack questions the couple already started.
let mockStartedPack: Record<string, string> = {};
jest.mock('@/features/packs/api', () => ({
  getPacks: () =>
    Promise.resolve([
      {
        id: 'p-1',
        slug: 'future-us',
        title: 'Future Us',
        description: 'd',
        isPremium: true,
        icon: 'future-us',
        questionCount: 3,
      },
    ]),
  getPack: () =>
    Promise.resolve({
      id: 'p-1',
      slug: 'future-us',
      title: 'Future Us',
      description: 'd',
      isPremium: true,
      icon: 'future-us',
      questions: [1, 2, 3].map((n) => ({ id: `q${n}`, position: n, body: `FIXTURE-PACK-Q${n}` })),
    }),
  startPackQuestion: (id: string) => mockStartPackQuestion(id),
  getStartedPackQuestions: () => Promise.resolve(mockStartedPack),
}));
jest.mock('@/features/thread/api', () => ({
  UNREAD_COUNTS_AVAILABLE: true,
  getUnreadThreadCounts: () => Promise.resolve(mockUnreadCounts),
  getThread: () => Promise.resolve([]),
  getUnreadCount: () => Promise.resolve(0),
  markThreadRead: () => Promise.resolve(),
  sendMessage: () => Promise.resolve(),
}));

// Boot smoke test for the real app/ tree: Expo Router throws on duplicate URL paths
// and missing layouts, so rendering every route here is our stand-in for a
// simulator boot until the dev environment is fixed.
const APP_DIR = './app';

// [url, screen id from design-handoff/screens.json]
// Reachable signed out (onboarding, sign-in, the join flow).
// Screens that are built carry `testID="<id>-screen"`; placeholders render the id as text.
const BUILT = new Set([
  '01',
  '02',
  '05',
  '06',
  '07',
  '47',
  'J3',
  'J10',
  '10',
  '11',
  '12',
  '13',
  '09',
  'J6',
  '18',
  '19',
  '20',
  '21',
  '22',
  '25',
  '52',
  '29',
  '30',
  '31',
  '32',
  '33',
  '16',
  '35',
  'J8',
  '15',
  '36',
  '40',
  '41',
  '42',
  '43',
  '58',
  '27',
]);
// 14 leaves for Today without a live server offer (D52): its own tests cover it.
async function expectScreen(id: string) {
  // Built screens may wait for their (mocked) data first.
  if (BUILT.has(id)) expect(await screen.findByTestId(`${id}-screen`)).toBeTruthy();
  else expect(screen.getByText(id)).toBeTruthy();
}

// J2 and J5 need an invite in memory (they fall back to the code screen without one): see their tests.
const PUBLIC_ROUTES: [string, string][] = [
  ['/welcome', '01'],
  ['/story/1', '02'],
  ['/quiz/stage', '05'],
  ['/quiz/goals', '06'],
  ['/quiz/names', '07'],
  ['/quiz/dates', '47'],
  ['/join/code', 'J3'],
  ['/join/full', 'J10'],
  ['/join/done', 'J8'],
];

// Signed in only (the auth gate, MOB-08).
const PROTECTED_ROUTES: [string, string][] = [
  ['/invite', '10'],
  ['/waiting', '11'],
  ['/join', '12'],
  ['/paired', '13'],
  ['/reminders', '09'],
  ['/partner-left', '58'],
  ['/today', '18'],
  ['/today/answer', '19'],
  ['/today/reveal', '20'],
  ['/today/revealed', '21'],
  ['/today/thread', '22'],
  ['/history', '29'],
  ['/history/q-123', '30'],
  ['/history/q-123/thread', '22'],
  ['/history/q-123/answer', '19'],
  ['/history/q-123/reveal', '20'],
  ['/history/q-123/revealed', '21'],
  ['/history/recap', '31'],
  ['/packs', '32'],
  ['/packs/p-1', '33'],
  ['/us', '40'],
  ['/us/notifications', '41'],
  ['/us/couple', '42'],
  ['/us/delete', '43'],
  ['/us/badges', '52'],
  ['/us/feedback', '27'],
  ['/paywall', '16'],
  ['/success', '35'],
  ['/gift/opened', '15'],
  ['/milestone/7', '25'],
];

// The first renderRouter() loads and transforms the whole app module graph (every route, the data
// layer, the UI library, the gallery). With a cold Jest cache (fresh CI runner, `npm ci`) that took
// 6 to 20 s inside the first test and tripped its 5 s timeout. Do it once in a hook with a limit
// sized for a cold cache; each test then only measures routing and rendering.
const COLD_START_MS = 90_000;

describe('app routes', () => {
  beforeAll(async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
  }, COLD_START_MS);

  beforeEach(() => {
    mockUser = null;
    mockCouple = SOLO;
    mockEntitlements = [];
    mockAccountTimes = OLD_ACCOUNT;
    useOnboarding.getState().reset();
    usePendingSetup.getState().reset();
    mockSetupCalls.length = 0;
    mockCreateCouple.mockClear();
    mockAlreadyPaired = null;
    mockSaveFirstAnswer.mockClear();
    mockSaveRitualTime.mockClear();
    usePendingInvite.getState().clear();
    // The soft-ask (09, J6) is once per device: each test starts on a fresh phone.
    setSoftAskStorage(memoryStorage());
    setPushStorage(memoryStorage());
    setReviewStorage(memoryStorage());
    mockAwards = [];
    mockStreak = null;
    mockCoupleDelayMs = 0;
    mockCoupleGate = null;
    mockCoupleError = null;
    useSeenBadges.setState({ seen: [] });
    mockOpenInvite = null;
    mockCreateInvite.mockClear();
    mockInviteLink.mockReset();
    mockInviteLink.mockResolvedValue(null);
    useMyInvite.getState().set(null);
    mockCramped = false;
    mockPendingRequests = [];
    mockUnreadCounts = {};
    mockHistoryRows = [];
    mockHistoryDays = [];
    mockFirstDay = null;
    mockHistoryDetail = null;
    mockLastMessage = null;
    mockGetHistoryPage.mockClear();
    mockGetLastMessage.mockClear();
    mockEndedRows = [];
    mockGetEndedPage.mockClear();
    mockGetEndedQuestion.mockClear();
    mockMyRequest = { status: 'pending', expiresAt: FUTURE };
    mockEnded = null;
    mockPrefs = null;
    mockSavePrefs.mockReset();
    mockSavePrefs.mockResolvedValue(undefined);
    mockDeleteAccount.mockReset();
    mockDeleteAccount.mockResolvedValue(undefined);
    mockProfileName.mockReset();
    mockProfileName.mockResolvedValue('Sam');
    mockUnpair.mockReset();
    mockUnpair.mockResolvedValue(undefined);
    mockWipe.mockClear();
    useEndedSeen.setState({ seen: [] });
    mockApproveJoin.mockReset();
    mockDeclineJoin.mockReset();
    usePendingJoin.getState().clear();
  });

  it('boots at / and redirects to onboarding when signed out', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    await expectScreen('01');
  });

  it('sends a signed-in person with a couple to Today', async () => {
    mockUser = { userId: 'u1' };
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/today'));
  });

  it.each([
    [
      '/auth/callback?code=cold',
      'bonded://auth/callback?code=cold',
      { kind: 'pkce', code: 'cold' },
    ],
    ['/?code=legacy', 'bonded://?code=legacy', { kind: 'pkce', code: 'legacy' }],
  ])('cold email callback %s enters the normal couple gate', async (initialUrl, url, callback) => {
    const initial = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(url);
    mockCompleteEmailCallback.mockResolvedValueOnce({ userId: 'u1' });
    try {
      const r = await renderRouter(APP_DIR, { initialUrl });
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
      expect(mockCompleteEmailCallback).toHaveBeenLastCalledWith(callback);
      expect(screen.queryByTestId('01-screen')).toBeNull();
    } finally {
      initial.mockResolvedValue(null);
    }
  });

  it('email callback resumes an invite at J5 without creating a solo bond', async () => {
    usePendingInvite
      .getState()
      .set({ code: '4827', token: 'invite-token-123456', inviterName: 'Maya' });
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('bonded://auth/callback?code=join');
    mockCompleteEmailCallback.mockResolvedValueOnce({ userId: 'u1' });
    try {
      const r = await renderRouter(APP_DIR, { initialUrl: '/auth/callback?code=join' });
      await waitFor(() => expect(r.getPathname()).toBe('/join/name'));
      expect(await screen.findByTestId('J5-screen')).toBeTruthy();
      expect(usePendingInvite.getState().code).toBe('4827');
    } finally {
      initial.mockResolvedValue(null);
    }
  });

  it.each([
    '#error_code=otp_expired',
    '#access_token=a&refresh_token=r',
    '?code=c#access_token=a&refresh_token=r',
  ])('invalid callback %s recovery keeps a pending invite and returns to J4', async (suffix) => {
    usePendingInvite.getState().set({ code: '4827', inviterName: 'Maya' });
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue(`bonded://auth/callback${suffix}`);
    mockCompleteEmailCallback.mockRejectedValueOnce(
      new AppError('UNKNOWN', 'Request a new email.'),
    );
    try {
      const r = await renderRouter(APP_DIR, { initialUrl: '/auth/callback' });
      await fireEvent.press(await screen.findByText('Request a new link or code'));
      expect(mockCompleteEmailCallback).toHaveBeenLastCalledWith({ kind: 'invalid' });
      await waitFor(() => expect(r.getPathname()).toBe('/join/sign-in'));
      expect(await screen.findByTestId('J4-email')).toBeTruthy();
      expect(usePendingInvite.getState().code).toBe('4827');
    } finally {
      initial.mockResolvedValue(null);
    }
  });

  it('expired email callback offers a new email and preserves the manual code path', async () => {
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('bonded://auth/callback?code=expired');
    mockCompleteEmailCallback.mockRejectedValueOnce(
      new AppError('UNKNOWN', 'That sign-in link has expired. Request a new email.'),
    );
    try {
      const r = await renderRouter(APP_DIR, { initialUrl: '/auth/callback?code=expired' });
      expect(
        await screen.findByText('That sign-in link has expired. Request a new email.'),
      ).toBeTruthy();
      await fireEvent.press(screen.getByText('Request a new link or code'));
      await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
      expect(await screen.findByTestId('08-email')).toBeTruthy();
    } finally {
      initial.mockResolvedValue(null);
    }
  });

  it('sends a signed-in person without a couple to the reminder primer, then the invite step', async () => {
    mockUser = { userId: 'u1' };
    mockCouple = null;
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    // MOB-15: 09 comes first while the OS has never asked; it steps aside to 10 once answered.
    await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
    await fireEvent.press(await screen.findByTestId('09-decline'));
    await waitFor(() => expect(r.getPathname()).toBe('/invite'));
  });

  describe('returning sign-in (D40)', () => {
    it('01 "I already have an account" opens sign-in without the story, quiz or progress', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
      await fireEvent.press(screen.getByTestId('01-sign-in'));
      await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
      expect(screen.getByText('Welcome back')).toBeTruthy();
      expect(screen.queryByTestId('08-progress')).toBeNull();
      expect(useOnboarding.getState().returning).toBe(true);
      // Back on 01 the normal onboarding is untouched.
      await fireEvent.press(screen.getByTestId('08-top-back'));
      await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
      expect(useOnboarding.getState().returning).toBe(false);
    });

    it('a returning solo sign-in goes straight to 10, then `/` means Today again', async () => {
      useOnboarding.getState().setReturning(true);
      mockUser = { userId: 'u1' };
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/invite'));
      await expectScreen('10');
      expect(screen.queryByTestId('02-screen')).toBeNull();
      expect(useOnboarding.getState().returning).toBe(false);
    });

    it('a returning sign-in with no couple skips the story and quiz: setup, 09, then 10', async () => {
      useOnboarding.getState().setReturning(true);
      mockUser = { userId: 'u1' };
      mockCouple = null;
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
      await fireEvent.press(await screen.findByTestId('09-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/invite'));
      // MOB-28: 47 was skipped too, so setup writes no key dates.
      expect(screen.queryByTestId('47-screen')).toBeNull();
      for (const [rows] of mockUpsertKeyDates.mock.calls) expect(rows).toEqual([]);
    });

    it('an existing account with no couple and no answers never sees onboarding again', async () => {
      mockUser = { userId: 'u1' };
      mockCouple = null;
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
    });

    it('a fresh sign-up with answers goes setup -> 09 -> 10, never back to the story (#93)', async () => {
      // 01 -> 02..07 -> 47 skip -> 08 sign-up: the answers are in the store, the account is new.
      const s = useOnboarding.getState();
      s.setStage('living_together');
      s.toggleGoal('laughing');
      s.setNames({ displayName: 'Noor', partnerName: 'Sam' });
      mockUser = { userId: 'u1' };
      mockCouple = null;
      const now = Date.now();
      mockAccountTimes = {
        created_at: new Date(now - 60_000).toISOString(),
        last_sign_in_at: new Date(now).toISOString(),
      };
      // The couple refetch after create_couple takes a moment, as on a phone.
      mockCoupleDelayMs = 300;
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'), { timeout: 3000 });
      // After the couple refetch and the account-age read: still on 09, not 02.
      expect(await screen.findByTestId('09-decline')).toBeTruthy();
      expect(r.getPathname()).toBe('/reminders');
      expect(screen.queryByTestId('02-screen')).toBeNull();
      expect(useOnboarding.getState().stage).toBeNull();
      await fireEvent.press(await screen.findByTestId('09-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/invite'));
    }, 15000);

    it('a fresh sign-up after the reminder ask was answered goes setup -> 10, not the story (#93)', async () => {
      declineSoftAsk(); // 09 steps aside to 10 at once (QA's fresh-install run).
      const s = useOnboarding.getState();
      s.setStage('living_together');
      s.setNames({ displayName: 'Noor', partnerName: 'Sam' });
      mockUser = { userId: 'u1' };
      mockCouple = null;
      const now = Date.now();
      mockAccountTimes = {
        created_at: new Date(now - 60_000).toISOString(),
        last_sign_in_at: new Date(now).toISOString(),
      };
      mockCoupleDelayMs = 300;
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/invite'), { timeout: 3000 });
      await expectScreen('10');
      expect(screen.queryByTestId('02-screen')).toBeNull();
    }, 15000);

    it('a brand-new account with no answers still gets the story and quiz', async () => {
      useOnboarding.getState().setReturning(true);
      mockUser = { userId: 'u1' };
      mockCouple = null;
      mockAccountTimes = {
        created_at: '2026-11-04T10:00:00Z',
        last_sign_in_at: '2026-11-04T10:02:00Z',
      };
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      // D50: the first step after 01 is 05.
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/stage'));
    });
  });

  it('a refused key-dates write offers Try again or going on without the dates (MOB-28)', async () => {
    mockUser = { userId: 'u1' };
    mockCouple = null;
    useOnboarding.getState().reset();
    useOnboarding.getState().setKeyDates({ birthday: '1990-05-09' }, true);
    // As the real api: no rows means no request, so only a non-empty write is refused.
    mockUpsertKeyDates.mockImplementation((rows) =>
      rows.length
        ? Promise.reject(new AppError('UNKNOWN', 'Something went wrong. Please try again.'))
        : Promise.resolve(),
    );
    try {
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      expect(await screen.findByTestId('setup-skip-dates')).toBeTruthy();
      expect(screen.getByTestId('setup-error')).toHaveTextContent(
        "Your bond is ready, but your dates weren't saved.",
        { exact: false },
      );
      expect(mockUpsertKeyDates).toHaveBeenLastCalledWith([
        expect.objectContaining({ kind: 'birthday', user_id: 'u1', date: '1990-05-09' }),
      ]);
      await fireEvent.press(screen.getByTestId('setup-skip-dates'));
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
      expect(mockUpsertKeyDates).toHaveBeenLastCalledWith([]);
      expect(useOnboarding.getState().keyDates).toEqual({});
    } finally {
      mockUpsertKeyDates.mockImplementation(() => Promise.resolve());
      useOnboarding.getState().reset();
    }
  });

  it('J6 renders for a signed-in joiner and sends a signed-out one to sign-in', async () => {
    mockUser = { userId: 'u2' };
    let r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
    await expectScreen('J6');
    mockUser = null;
    r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
    await waitFor(() => expect(r.getPathname()).toBe('/join/sign-in'));
  });

  describe('J6 -> J8 or 13 (MOB-47)', () => {
    const PAIRED = {
      ...SOLO,
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
    };
    beforeEach(() => {
      mockUser = { userId: 'u2' };
      mockCouple = PAIRED;
    });

    it('a premium couple (the partner pays) goes to J8 with the plan card', async () => {
      mockEntitlements = [{ user_id: 'u1', is_active: true, expires_at: null }];
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      await fireEvent.press(await screen.findByTestId('J6-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/join/done'));
      expect(await screen.findByTestId('J8-screen')).toBeTruthy();
      expect(await screen.findByTestId('J8-partner-plan')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('J8-continue'));
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
    });

    it('a free couple goes to 13', async () => {
      mockEntitlements = [];
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      await fireEvent.press(await screen.findByTestId('J6-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/paired'));
      expect(await screen.findByTestId('13-screen')).toBeTruthy();
      expect(screen.queryByTestId('J8-screen')).toBeNull();
    });

    it('"Turn on reminders" on a premium couple also ends on J8', async () => {
      mockEntitlements = [{ user_id: 'u1', is_active: true, expires_at: null }];
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      await fireEvent.press(await screen.findByTestId('J6-accept'));
      await waitFor(() => expect(r.getPathname()).toBe('/join/done'));
    });

    it('an expired partner plan is free: 13', async () => {
      mockEntitlements = [{ user_id: 'u1', is_active: true, expires_at: '2000-01-01T00:00:00Z' }];
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      await fireEvent.press(await screen.findByTestId('J6-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/paired'));
    });

    it('with the soft-ask already answered on this phone, J6 steps aside to J8 or 13', async () => {
      declineSoftAsk();
      mockEntitlements = [{ user_id: 'u1', is_active: true, expires_at: null }];
      let r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      await waitFor(() => expect(r.getPathname()).toBe('/join/done'));
      mockEntitlements = [];
      r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      await waitFor(() => expect(r.getPathname()).toBe('/paired'));
    });
  });

  it('Today shows the 52b sheet once for a new 3-day badge (MOB-17)', async () => {
    mockUser = { userId: 'u1' };
    mockAwards = [
      {
        id: 'aw-3',
        badge_slug: 'streak-3',
        couple_id: 'couple-1',
        user_id: null,
        awarded_at: new Date().toISOString(),
      },
    ];
    await renderRouter(APP_DIR, { initialUrl: '/today' });
    expect(await screen.findByText('3-day badge unlocked!')).toBeTruthy();
    expect(useSeenBadges.getState().seen).toEqual(['aw-3']);
    await fireEvent.press(screen.getByTestId('52b-keep-going'));
    await waitFor(() => expect(screen.queryByText('3-day badge unlocked!')).toBeNull());
  });

  it('Today opens the 25 milestone for a new 7-day badge, and only once (MOB-17)', async () => {
    mockUser = { userId: 'u1' };
    mockAwards = [
      {
        id: 'aw-7',
        badge_slug: 'streak-7',
        couple_id: 'couple-1',
        user_id: null,
        awarded_at: new Date().toISOString(),
      },
    ];
    let r = await renderRouter(APP_DIR, { initialUrl: '/today' });
    await waitFor(() => expect(r.getPathname()).toBe('/milestone/7'));
    expect(await screen.findByTestId('25-screen')).toBeTruthy();
    r = await renderRouter(APP_DIR, { initialUrl: '/today' });
    // Seen on this device: Today loads its question and stays put.
    expect(await screen.findByTestId('18-screen')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(r.getPathname()).toBe('/today');
  });

  describe('no replayed milestones (MOB-41)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const utcDay = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
    const award = (step: number, at: Date) => ({
      id: `aw-${step}`,
      badge_slug: `streak-${step}`,
      couple_id: 'couple-1',
      user_id: null,
      awarded_at: at.toISOString(),
    });
    const streakRow = (current: number, lastOffsetDays: number) => ({
      current,
      longest: current,
      last_completed_on: utcDay(lastOffsetDays),
      completed_today: lastOffsetDays === 0,
      at_risk: false,
      saver_available: false,
    });
    const staysOnToday = async (r: { getPathname: () => string }) => {
      expect(await screen.findByTestId('18-screen')).toBeTruthy();
      await act(async () => {
        await Promise.resolve();
      });
      expect(r.getPathname()).toBe('/today');
      expect(screen.queryByTestId('25-screen')).toBeNull();
      expect(screen.queryByText(/badge unlocked!/)).toBeNull();
    };

    it('a fresh sign-in with a 7-day-old milestone shows no 25 and no 52b', async () => {
      mockUser = { userId: 'u1' };
      mockStreak = streakRow(11, -1);
      mockAwards = [
        award(7, new Date(Date.now() - 7 * DAY)),
        award(3, new Date(Date.now() - 9 * DAY)),
      ];
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      await staysOnToday(r);
      // Not marked seen either: nothing was shown.
      expect(useSeenBadges.getState().seen).toEqual([]);
    });

    it('an award written just now for steps reached days ago (streak-11-your-turn) is not replayed', async () => {
      mockUser = { userId: 'u1' };
      // 11 days, last completed yesterday: 7 was reached 5 days ago, 3 nine days ago.
      mockStreak = streakRow(11, -1);
      mockAwards = [award(7, new Date()), award(3, new Date())];
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      await staysOnToday(r);
    });

    it('a step reached today still opens 25', async () => {
      mockUser = { userId: 'u1' };
      mockStreak = streakRow(7, 0);
      mockAwards = [award(7, new Date())];
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      await waitFor(() => expect(r.getPathname()).toBe('/milestone/7'));
    });

    it('a step reached yesterday (inside 48 h) still shows 52b', async () => {
      mockUser = { userId: 'u1' };
      mockStreak = streakRow(4, 0);
      mockAwards = [award(3, new Date(Date.now() - 20 * 60 * 60 * 1000))];
      await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByText('3-day badge unlocked!')).toBeTruthy();
    });
  });

  describe('day-3 gift (MOB-64, D52)', () => {
    const PAIRED_NOW = {
      ...SOLO,
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
    };
    const H = 60 * 60 * 1000;
    const unopened = () =>
      Promise.resolve(toServerOffer({ eligible: true, expires_at: null, first_opened_at: null }));
    const opened = (left: number) => () => {
      const now = Date.now();
      return Promise.resolve(
        toServerOffer({
          eligible: true,
          expires_at: new Date(now + left).toISOString(),
          server_now: new Date(now).toISOString(),
        }),
      );
    };
    const threeDayBadge = () => [
      {
        id: 'aw-3',
        badge_slug: 'streak-3',
        couple_id: 'couple-1',
        user_id: null,
        awarded_at: new Date().toISOString(),
      },
    ];

    beforeEach(() => {
      mockUser = { userId: 'u1' };
      mockCouple = PAIRED_NOW;
      mockEntitlements = [];
      mockStreak = null;
      mockGetOffer.mockReset();
      mockGetOffer.mockImplementation(mockNoOffer);
      mockOpenOffer.mockReset();
      mockOpenOffer.mockImplementation(mockNoOffer);
      mockClaimOfferScreen.mockReset();
      mockClaimOfferScreen.mockImplementation(() => Promise.resolve(true));
      useOfferShown.setState({ shown: [] });
      cacheStorage.removeItem('query-cache');
    });

    it('13 goes straight to Today: the gift after pairing is retired', async () => {
      mockGetOffer.mockImplementation(unopened);
      mockClaimOfferScreen.mockImplementation(() => Promise.resolve(false));
      const r = await renderRouter(APP_DIR, { initialUrl: '/paired' });
      await fireEvent.press(await screen.findByTestId('13-continue'));
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
      expect(mockGetOffer).not.toHaveBeenCalledWith('intro');
    });

    it("the first 3-day badge with a live gift: 14 instead of 52b, claimed as the day's one offer", async () => {
      mockAwards = threeDayBadge();
      mockGetOffer.mockImplementation(unopened);
      mockOpenOffer.mockImplementation(opened(12 * H));
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      await waitFor(() => expect(r.getPathname()).toBe('/gift'));
      expect(mockClaimOfferScreen).toHaveBeenCalledWith('gift');
      expect(useSeenBadges.getState().seen).toEqual(['aw-3']);
      expect(useOfferShown.getState().wasShown('couple-1', 'day3')).toBe(true);
      expect(screen.queryByText('3-day badge unlocked!')).toBeNull();
      await fireEvent.press(await screen.findByTestId('14-open'));
      await waitFor(() => expect(r.getPathname()).toBe('/gift/opened'));
      expect(mockOpenOffer).toHaveBeenCalledWith('day3');
      expect(await screen.findByTestId('15-countdown')).toBeTruthy();
      // "Not now" just closes: back on Today with the chip, never 16 or 17.
      await fireEvent.press(screen.getByTestId('15-later'));
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
      expect(await screen.findByTestId('today-gift-chip')).toBeTruthy();
      expect(screen.queryByTestId('17-sheet')).toBeNull();
      expect(screen.queryByTestId('16-screen')).toBeNull();
    });

    it('no gift from the server: the 3-day badge shows 52b as before', async () => {
      mockAwards = threeDayBadge();
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByText('3-day badge unlocked!')).toBeTruthy();
      expect(r.getPathname()).toBe('/today');
      expect(mockClaimOfferScreen).not.toHaveBeenCalled();
    });

    it('another full-screen offer already shown today: 52b, the gift waits on the chip', async () => {
      mockAwards = threeDayBadge();
      mockGetOffer.mockImplementation(unopened);
      mockClaimOfferScreen.mockImplementation(() => Promise.resolve(false));
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByText('3-day badge unlocked!')).toBeTruthy();
      expect(mockClaimOfferScreen).toHaveBeenCalledWith('gift');
      expect(r.getPathname()).toBe('/today');
      expect(await screen.findByTestId('today-gift-chip')).toBeTruthy();
    });

    it('14 already shown on this phone: 52b, no second claim', async () => {
      mockAwards = threeDayBadge();
      mockGetOffer.mockImplementation(unopened);
      useOfferShown.getState().markShown('couple-1', 'day3');
      await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByText('3-day badge unlocked!')).toBeTruthy();
      expect(mockClaimOfferScreen).not.toHaveBeenCalled();
    });

    it('an opened gift: the Today chip reopens 15; the Us Premium row shows it too', async () => {
      mockGetOffer.mockImplementation(opened(11 * H + 41 * 60_000 + 30_000));
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      const chip = await screen.findByTestId('today-gift-chip');
      expect(screen.getByTestId('today-gift-chip-label')).toHaveTextContent(
        '25% off · ends in 11:42',
      );
      // Opened by the partner already: no 14 by itself, nothing claimed.
      expect(mockClaimOfferScreen).not.toHaveBeenCalled();
      await fireEvent.press(chip);
      await waitFor(() => expect(r.getPathname()).toBe('/gift/opened'));

      const us = await renderRouter(APP_DIR, { initialUrl: '/us' });
      const row = await screen.findByTestId('40-premium');
      await waitFor(() => expect(row).toHaveTextContent(/25% off · ends in 11:4\d/));
      await fireEvent.press(row);
      await waitFor(() => expect(us.getPathname()).toBe('/gift/opened'));
    });

    it('/paywall ignores a live gift (D52): `default`, no countdown, no get_offer', async () => {
      mockGetOffer.mockImplementation(opened(H));
      resetPurchasesForTests();
      process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
      purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
      try {
        await renderRouter(APP_DIR, { initialUrl: '/paywall' });
        expect(await screen.findByText('Y-PRICE a year for both')).toBeTruthy();
        expect(screen.queryByText(/O-PRICE|Offer ends in/)).toBeNull();
        expect(mockGetOffer).not.toHaveBeenCalled();
      } finally {
        delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
        resetPurchasesForTests();
      }
    });

    it('a premium couple never asks for an offer', async () => {
      mockEntitlements = [{ user_id: 'u2', is_active: true, expires_at: null }];
      mockAwards = threeDayBadge();
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByText('3-day badge unlocked!')).toBeTruthy();
      expect(mockGetOffer).not.toHaveBeenCalled();
      expect(mockClaimOfferScreen).not.toHaveBeenCalled();
      expect(r.getPathname()).toBe('/today');
      expect(screen.queryByTestId('today-gift-chip')).toBeNull();
    });
  });

  describe('28 streak saver (MOB-21, D18)', () => {
    const PAIRED = {
      ...SOLO,
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
    };
    const DAY = 24 * 60 * 60 * 1000;
    const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    // Missed yesterday: `current` is already 0 (CONTRACTS get_streak).
    const missed = (saverAvailable: boolean) => ({
      current: 0,
      longest: 11,
      last_completed_on: twoDaysAgo,
      completed_today: false,
      at_risk: false,
      saver_available: saverAvailable,
    });
    // After the saver: yesterday is protected, 11 restores to 11 (D18).
    const restored = {
      current: 11,
      longest: 11,
      last_completed_on: yesterday,
      completed_today: false,
      at_risk: true,
      saver_available: false,
    };
    const PREMIUM = [{ user_id: 'u2', is_active: true, expires_at: null }];

    beforeEach(() => {
      mockUser = { userId: 'u1' };
      mockCouple = PAIRED;
      mockClaimSaver.mockReset();
      cacheStorage.removeItem('query-cache');
    });

    it('premium + available: Use streak saver restores the streak (server result, then refetch)', async () => {
      mockEntitlements = PREMIUM;
      mockStreak = missed(true);
      mockClaimSaver.mockImplementation(() => {
        mockStreak = restored;
        return Promise.resolve(restored);
      });
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByTestId('28-saver-available')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('28-saver'));
      await waitFor(() => expect(mockClaimSaver).toHaveBeenCalledTimes(1));
      // Not napping any more: Today is back on "your turn" with the 11-day streak.
      expect(await screen.findByTestId('18-screen')).toBeTruthy();
      expect(screen.queryByTestId('28-screen')).toBeNull();
      expect(r.getPathname()).toBe('/today');
    });

    it('used this month: the RPC says SAVER_UNAVAILABLE, the inline copy says so', async () => {
      mockEntitlements = PREMIUM;
      mockStreak = missed(true);
      mockClaimSaver.mockImplementation(() => {
        mockStreak = missed(false);
        return Promise.reject(new AppError('SAVER_UNAVAILABLE', 'x'));
      });
      await renderRouter(APP_DIR, { initialUrl: '/today' });
      await fireEvent.press(await screen.findByTestId('28-saver'));
      expect(
        await screen.findByText(
          "You've already used this month's streak saver. A new one comes next month.",
        ),
      ).toBeTruthy();
      // The streak refetch turned the card into "nothing to save": no button to press again.
      await waitFor(() => expect(screen.queryByTestId('28-saver')).toBeNull());
      expect(screen.getByTestId('28-saver-unavailable')).toBeTruthy();
    });

    it('premium but nothing to save (saver_available false): no button, a calm line', async () => {
      mockEntitlements = PREMIUM;
      mockStreak = missed(false);
      await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByTestId('28-saver-unavailable')).toBeTruthy();
      expect(screen.getByTestId('28-saver-none')).toBeTruthy();
      expect(screen.queryByTestId('28-saver')).toBeNull();
      expect(mockClaimSaver).not.toHaveBeenCalled();
    });

    it('free couple: the premium card opens the paywall, never the RPC', async () => {
      mockEntitlements = [];
      mockStreak = missed(false);
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByTestId('28-saver-offer')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('28-saver'));
      await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
      expect(mockClaimSaver).not.toHaveBeenCalled();
    });

    it.each([
      [
        'PREMIUM_REQUIRED',
        'Streak saver is part of Premium. Upgrade to protect your streak for both of you.',
      ],
      ['NETWORK', 'No connection right now.'],
    ])('error mapping: %s', async (kind, copy) => {
      mockEntitlements = PREMIUM;
      mockStreak = missed(true);
      mockClaimSaver.mockRejectedValue(
        new AppError(kind as 'PREMIUM_REQUIRED', kind === 'NETWORK' ? copy : 'x'),
      );
      await renderRouter(APP_DIR, { initialUrl: '/today' });
      await fireEvent.press(await screen.findByTestId('28-saver'));
      expect(await screen.findByTestId('28-saver-error')).toBeTruthy();
      expect(screen.getByText(copy)).toBeTruthy();
    });
  });

  describe('packs (MOB-20, D51)', () => {
    beforeEach(() => {
      mockUser = { userId: 'u1' };
      mockStartPackQuestion.mockReset();
      mockStartedPack = {};
    });

    it('free couple: 32 -> 33 -> a locked row opens the paywall from the pack (34)', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/packs' });
      await fireEvent.press(await screen.findByTestId('32-pack-future-us'));
      await waitFor(() => expect(r.getPathname()).toBe('/packs/p-1'));
      expect(await screen.findByText('FIXTURE-PACK-Q1')).toBeTruthy();
      expect(screen.getByText('A question from this pack')).toBeTruthy();
      expect(screen.queryByText('FIXTURE-PACK-Q2')).toBeNull();
      await fireEvent.press(screen.getByTestId('33-locked-2'));
      await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
      expect(r.getSearchParams()).toMatchObject({ from: 'pack', packId: 'p-1' });
      expect(await screen.findByTestId('34-screen')).toBeTruthy();
      expect(mockStartPackQuestion).not.toHaveBeenCalled();
    });

    it('free couple: a question started before D51 stays openable, 33 -> its answer screen (19)', async () => {
      mockStartedPack = { q2: 'cq-7' };
      mockHistoryDetail = {
        id: 'cq-7',
        source: 'pack',
        assignedFor: null,
        createdAt: new Date().toISOString(),
        answerCount: 0,
        question: 'FIXTURE-PACK-Q2',
        answeredBy: [],
        replies: 0,
      };
      const r = await renderRouter(APP_DIR, { initialUrl: '/packs/p-1' });
      await fireEvent.press(await screen.findByTestId('33-started-2'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/answer'));
      expect(await screen.findByTestId('19-field')).toBeTruthy();
      expect(mockStartPackQuestion).not.toHaveBeenCalled();
    });

    it('PREMIUM_REQUIRED from the server (premium here, stale) lands on 34, not the question', async () => {
      mockEntitlements = [{ user_id: 'u1', is_active: true, expires_at: null }];
      mockStartPackQuestion.mockRejectedValue(new AppError('PREMIUM_REQUIRED', 'x'));
      const r = await renderRouter(APP_DIR, { initialUrl: '/packs/p-1' });
      await fireEvent.press(await screen.findByTestId('33-question-1'));
      await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
      expect(mockStartPackQuestion).toHaveBeenCalledWith('q1');
      expect(await screen.findByTestId('34-screen')).toBeTruthy();
    });

    it('premium couple: a question the server opens goes straight to its answer screen (19)', async () => {
      mockEntitlements = [{ user_id: 'u1', is_active: true, expires_at: null }];
      mockHistoryDetail = {
        id: 'cq-7',
        source: 'pack',
        assignedFor: null,
        createdAt: new Date().toISOString(),
        answerCount: 0,
        question: 'FIXTURE-PACK-Q3',
        answeredBy: [],
        replies: 0,
      };
      mockStartPackQuestion.mockResolvedValue('cq-7');
      const r = await renderRouter(APP_DIR, { initialUrl: '/packs/p-1' });
      await fireEvent.press(await screen.findByTestId('33-question-3'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/answer'));
      expect(await screen.findByTestId('19-screen')).toBeTruthy();
      expect(await screen.findByText('FIXTURE-PACK-Q3')).toBeTruthy();
    });
  });

  describe('answering a pack question (MOB-49)', () => {
    const revealedApi = jest.mocked(getRevealedQuestion);
    const PARTNER_TEXT = 'FIXTURE-PARTNER-PACK-ANSWER';
    const MY_TEXT = 'FIXTURE-MY-PACK-ANSWER';
    const PAIRED = {
      ...SOLO,
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
    };
    const detail = (answeredBy: string[]) => ({
      id: 'cq-7',
      source: 'pack',
      assignedFor: null,
      createdAt: new Date().toISOString(),
      answerCount: answeredBy.length,
      question: 'FIXTURE-PACK-Q1',
      answeredBy,
      replies: 0,
    });
    const BOTH = {
      id: 'cq-7',
      answerCount: 2,
      question: 'FIXTURE-PACK-Q1',
      answers: [
        {
          id: 'a2',
          userId: 'u2',
          body: PARTNER_TEXT,
          createdAt: '2026-11-10T20:00:00Z',
          reactions: [],
        },
        { id: 'a1', userId: 'u1', body: MY_TEXT, createdAt: '2026-11-10T19:00:00Z', reactions: [] },
      ],
    };
    /** The reveal rule as the screen reader would meet it: no partner text anywhere in the tree. */
    const expectNoPartnerText = () => {
      expect(screen.queryByText(PARTNER_TEXT)).toBeNull();
      expect(screen.queryByText(PARTNER_TEXT, { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByLabelText(new RegExp(PARTNER_TEXT))).toBeNull();
    };
    const hold = async () =>
      fireEvent(await screen.findByTestId('20-hold'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });

    beforeEach(() => {
      mockUser = { userId: 'u1' };
      mockCouple = PAIRED;
      mockStartPackQuestion.mockReset();
      mockStartPackQuestion.mockResolvedValue('cq-7');
      // D51: starting a pack question needs Premium (the partner's plan covers me).
      mockEntitlements = [{ user_id: 'u2', is_active: true, expires_at: null }];
      mockSaveAnswer.mockClear();
      revealedApi.mockReset();
      // Like RLS: my answer once written; the partner's only once mine exists too.
      revealedApi.mockImplementation(() => {
        const by = (mockHistoryDetail as { answeredBy: string[] } | null)?.answeredBy ?? [];
        const visible = by.includes('u1') ? by : [];
        return Promise.resolve({
          ...BOTH,
          answerCount: by.length,
          answers: BOTH.answers.filter((a) => visible.includes(a.userId)),
        });
      });
      cacheStorage.removeItem('query-cache');
      useDrafts.getState().reset();
      clearOutbox();
    });

    it('33 -> answer -> 30 waiting -> partner answers -> 20 hold -> 21 reveal', async () => {
      mockHistoryDetail = detail([]);
      const r = await renderRouter(APP_DIR, { initialUrl: '/packs/p-1' });
      await fireEvent.press(await screen.findByTestId('33-question-1'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/answer'));
      expect(await screen.findByText('Pack question')).toBeTruthy();
      expect(await screen.findByTestId('19-field')).toBeTruthy();
      expect(screen.getAllByText('FIXTURE-PACK-Q1').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('19-partner-answered')).toBeNull();

      // Lock in: the server now has my answer; Sam hasn't answered.
      await fireEvent.changeText(screen.getByTestId('19-field'), MY_TEXT);
      mockHistoryDetail = detail(['u1']);
      await fireEvent.press(screen.getByTestId('19-submit'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7'));
      expect(mockSaveAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ coupleQuestionId: 'cq-7', userId: 'u1', body: MY_TEXT }),
      );
      expect(await screen.findByTestId('30-partner-waiting')).toBeTruthy();
      expect(screen.queryByTestId('30-partner-missed')).toBeNull();
      expectNoPartnerText();
      // D13: the waiting state requests no answer text at all, not even mine.
      expect(revealedApi).not.toHaveBeenCalled();
      expect(screen.queryByTestId('30-mine')).toBeNull();

      // Sam answers: realtime refreshes 30, which sends me to the hold (20), still without text.
      mockHistoryDetail = detail(['u1', 'u2']);
      revealedApi.mockClear();
      await act(async () => {
        mockRealtime.emit('answers', { new: { couple_question_id: 'cq-7' } });
      });
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/reveal'));
      expect(await screen.findByTestId('20-sealed')).toBeTruthy();
      expectNoPartnerText();
      expect(revealedApi).not.toHaveBeenCalled();

      await hold();
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/revealed'));
      expect(await screen.findByText(PARTNER_TEXT)).toBeTruthy();
      expect(screen.getByText(MY_TEXT)).toBeTruthy();
      expect(revealedApi).toHaveBeenCalledWith('cq-7');
      // Pack questions don't count for the streak: no streak chip here.
      expect(screen.queryByTestId('21-streak')).toBeNull();
      expect(useDrafts.getState().revealed).toContain('cq-7');

      // D45: "+" opens the full picker here too; any emoji is saved on their answer.
      await fireEvent.press(screen.getByTestId('21-react-more'));
      await fireEvent.changeText(await screen.findByTestId('21-react-picker-search'), 'sparkles');
      await fireEvent.press(await screen.findByTestId('21-react-picker-2728'));
      await waitFor(() =>
        expect(mockSetAnswerReaction).toHaveBeenCalledWith({
          answerId: 'a2',
          userId: 'u1',
          kind: '✨',
        }),
      );
      expect(screen.queryByTestId('21-react-picker')).toBeNull();

      // Talk opens this question's thread.
      await fireEvent.press(screen.getByTestId('21-talk'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/thread'));
    });

    it('the reveal rule: the partner answered first; nothing of theirs shows before I lock in', async () => {
      mockHistoryDetail = detail(['u2']);
      const r = await renderRouter(APP_DIR, { initialUrl: '/packs/p-1' });
      await fireEvent.press(await screen.findByTestId('33-question-1'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/answer'));
      expect(await screen.findByTestId('19-partner-answered')).toBeTruthy();
      expectNoPartnerText();
      expect(revealedApi).not.toHaveBeenCalled();

      await fireEvent.changeText(screen.getByTestId('19-field'), MY_TEXT);
      mockHistoryDetail = detail(['u1', 'u2']);
      await fireEvent.press(screen.getByTestId('19-submit'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/reveal'));
      expect(await screen.findByTestId('20-sealed')).toBeTruthy();
      expectNoPartnerText();
      expect(revealedApi).not.toHaveBeenCalled();
      await hold();
      expect(await screen.findByText(PARTNER_TEXT)).toBeTruthy();
    });

    it('30 routes an unanswered pack question (a push or deep link) into the answer flow', async () => {
      mockHistoryDetail = detail(['u2']);
      const r = await renderRouter(APP_DIR, { initialUrl: '/question/cq-7' });
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/answer'));
      expect(await screen.findByTestId('19-screen')).toBeTruthy();
      expectNoPartnerText();
      expect(revealedApi).not.toHaveBeenCalled();
    });

    it('30 sends both-answered to the hold first, then shows the archive once revealed here', async () => {
      mockHistoryDetail = detail(['u1', 'u2']);
      const r = await renderRouter(APP_DIR, { initialUrl: '/history/cq-7' });
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7/reveal'));
      expect(revealedApi).not.toHaveBeenCalled();

      useDrafts.getState().markRevealed('cq-7');
      const again = await renderRouter(APP_DIR, { initialUrl: '/history/cq-7' });
      expect(await screen.findByTestId('30-partner')).toBeTruthy();
      expect(screen.getByText(PARTNER_TEXT)).toBeTruthy();
      expect(again.getPathname()).toBe('/history/cq-7');
    });

    it('33 on a question I already answered goes to 30 (waiting), not a second answer', async () => {
      mockHistoryDetail = detail(['u1']);
      const r = await renderRouter(APP_DIR, { initialUrl: '/packs/p-1' });
      await fireEvent.press(await screen.findByTestId('33-question-1'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-7'));
      expect(await screen.findByTestId('30-partner-waiting')).toBeTruthy();
      expect(screen.queryByTestId('19-submit')).toBeNull();
      expect(revealedApi).not.toHaveBeenCalled();
    });

    it("today's question flow is unchanged: /today/answer still answers today's question", async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/today/answer' });
      expect(await screen.findByText("Today's question")).toBeTruthy();
      expect(await screen.findByText('What made you smile?')).toBeTruthy();
      await fireEvent.changeText(screen.getByTestId('19-field'), MY_TEXT);
      await fireEvent.press(screen.getByTestId('19-submit'));
      await waitFor(() =>
        expect(mockSaveAnswer).toHaveBeenCalledWith(
          expect.objectContaining({ coupleQuestionId: 'cq-1', body: MY_TEXT }),
        ),
      );
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
    });
  });

  it.each(PUBLIC_ROUTES)('%s renders screen %s (signed out)', async (url, id) => {
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    expect(r.getPathname()).toBe(url);
    await expectScreen(id);
  });

  it.each(PROTECTED_ROUTES)('%s renders screen %s (signed in)', async (url, id) => {
    mockUser = { userId: 'u1' };
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    expect(r.getPathname()).toBe(url);
    await expectScreen(id);
  });

  it.each(PROTECTED_ROUTES.map(([url]) => url))('%s is closed when signed out', async (url) => {
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
  });

  it.each([
    ['/sign-in', '08'],
    ['/join/sign-in', 'J4'],
  ])('%s renders the sign-in screen %s signed out', async (url, id) => {
    const r = await renderRouter(APP_DIR, { initialUrl: url });
    expect(r.getPathname()).toBe(url);
    expect(screen.getByTestId(`${id}-screen`)).toBeTruthy();
    expect(screen.getByTestId(`${id}-google`)).toBeTruthy();
    expect(screen.getByTestId(`${id}-email`)).toBeTruthy();
  });

  describe('D50 T1, N, L, P2 (MOB-61)', () => {
    afterEach(() => {
      useOnboarding.getState().reset();
      usePendingSetup.getState().reset();
    });

    it('T1 → N (reminders on) → L → P2 → sign-in keeps the answer and the time on the phone', async () => {
      useOnboarding.getState().setNames({ displayName: 'Maya', partnerName: 'Sam' });
      const r = await renderRouter(APP_DIR, { initialUrl: '/plan/first-question' });
      expect(screen.getByTestId('T1-screen')).toBeTruthy();
      await fireEvent.changeText(screen.getByTestId('T1-field'), 'FIXTURE-T1 your laugh');
      await fireEvent.press(screen.getByTestId('T1-submit'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/moment'));
      await fireEvent.press(screen.getByTestId('N-time-lunch'));
      await fireEvent.press(screen.getByTestId('N-accept'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/building'));
      expect(await screen.findByText('Reminders set for 12:30')).toBeTruthy();
      await waitFor(() => expect(r.getPathname()).toBe('/plan/yours'), { timeout: 6000 });
      expect(screen.getByTestId('P2-summary')).toHaveTextContent(
        'Bonded turns this into 3 minutes a day for Maya & Sam, at 12:30.',
      );
      // L replaced itself: Back from P2 is N.
      await fireEvent.press(screen.getByTestId('P2-top-back'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/moment'));
      await fireEvent.press(screen.getByTestId('N-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/yours'), { timeout: 6000 });
      await fireEvent.press(screen.getByTestId('P2-start'));
      await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
      expect(usePendingSetup.getState()).toMatchObject({
        firstAnswer: { body: 'FIXTURE-T1 your laugh' },
        ritualTime: '12:30',
        reminders: 'off',
      });
      // Nothing is sent before sign-in.
      expect(mockSetupCalls).toEqual([]);
    }, 20000);

    it('P3 (MOB-62): P2 → P3 → × → 17 → "Continue with free" → sign-in; no key: P3 steps aside', async () => {
      useOnboarding.getState().setNames({ displayName: 'Maya', partnerName: 'Sam' });
      resetPurchasesForTests();
      process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
      purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
      try {
        const r = await renderRouter(APP_DIR, { initialUrl: '/plan/yours' });
        await fireEvent.press(screen.getByTestId('P2-start'));
        await waitFor(() => expect(r.getPathname()).toBe('/plan/trial'));
        expect(await screen.findByText('Y-PRICE a year for both')).toBeTruthy();
        expect(screen.getByText('Get closer to Sam, starting tonight')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('P3-close'));
        await fireEvent.press(await screen.findByTestId('17-leave'));
        await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
        expect(purchasesMock.purchasePackage).not.toHaveBeenCalled();
      } finally {
        delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
        resetPurchasesForTests();
      }
      // Without a RevenueCat key there is nothing to sell: P3 replaces itself with sign-in.
      const r2 = await renderRouter(APP_DIR, { initialUrl: '/plan/trial' });
      await waitFor(() => expect(r2.getPathname()).toBe('/sign-in'));
    });

    it('after sign-in: ritual time, answers, day-1 question, then T1 once; 09 is not asked again', async () => {
      declineSoftAsk(); // "Not now" on N
      const s = useOnboarding.getState();
      s.setStage('dating');
      s.setNames({ displayName: 'Maya', partnerName: 'Sam' });
      usePendingSetup.getState().setFirstAnswer('FIXTURE-T1 your laugh');
      usePendingSetup.getState().setRitual('19:45', 'off');
      mockUser = { userId: 'u1' };
      mockCouple = null;
      const now = Date.now();
      mockAccountTimes = {
        created_at: new Date(now - 60_000).toISOString(),
        last_sign_in_at: new Date(now).toISOString(),
      };
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/invite'), { timeout: 3000 });
      expect(mockSetupCalls).toEqual([
        'ritual_time',
        'onboarding_answers',
        'get_daily_question',
        'answer',
      ]);
      expect(mockSaveRitualTime).toHaveBeenCalledWith('u1', '19:45');
      expect(mockSaveFirstAnswer).toHaveBeenCalledTimes(1);
      expect(mockSaveFirstAnswer).toHaveBeenCalledWith({
        coupleQuestionId: 'cq-day1',
        userId: 'u1',
        body: 'FIXTURE-T1 your laugh',
      });
      expect(usePendingSetup.getState().firstAnswer).toBeNull();
      // A relaunch never sends it again.
      await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(mockSaveFirstAnswer).toHaveBeenCalledTimes(1));
    }, 15000);

    it('a failed T1 write keeps it on the phone and Try again sends it', async () => {
      mockSaveFirstAnswer.mockImplementationOnce(() =>
        Promise.reject(new AppError('NETWORK', "You're offline.")),
      );
      declineSoftAsk();
      useOnboarding.getState().setStage('dating');
      usePendingSetup.getState().setFirstAnswer('FIXTURE-T1 retry');
      mockUser = { userId: 'u1' };
      mockCouple = null;
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      expect(await screen.findByTestId('setup-error')).toBeTruthy();
      expect(usePendingSetup.getState().firstAnswer?.body).toBe('FIXTURE-T1 retry');
      await fireEvent.press(screen.getByTestId('setup-retry'));
      await waitFor(() => expect(r.getPathname()).toBe('/invite'), { timeout: 3000 });
      expect(mockSaveFirstAnswer).toHaveBeenCalledTimes(2);
      expect(usePendingSetup.getState().firstAnswer).toBeNull();
    }, 15000);

    it('06 continues straight to T1, and back from T1 is 06 (MOB-69: no 47)', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/quiz/goals' });
      await fireEvent.press(screen.getByTestId('06-next'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/first-question'));
      expect(screen.queryByTestId('47-screen')).toBeNull();
      await fireEvent.press(screen.getByTestId('T1-top-back'));
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/goals'));
    });

    it('T1 opened directly (a resume): Back goes to 06, not 47 (MOB-69)', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/plan/first-question' });
      await fireEvent.press(await screen.findByTestId('T1-top-back'));
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/goals'));
    });
  });

  describe('onboarding kept on the phone (MOB-61b)', () => {
    const KEY = 'onboardingPending:quiz';
    const onDisk = () => secureStore().getString(KEY);
    // An app kill: memory is gone, a new launch reads only what the encrypted store kept.
    const killAndRelaunch = () => {
      const relaunched = createOnboardingStore(createKeyValueStorage('onboardingPending:'));
      const data = Object.fromEntries(
        Object.entries(relaunched.getState()).filter(([, v]) => typeof v !== 'function'),
      );
      useOnboarding.setState(data);
    };
    const keepQuiz = (
      step: Parameters<ReturnType<typeof useOnboarding.getState>['setStep']>[0],
    ) => {
      const s = useOnboarding.getState();
      s.setStage('dating');
      s.setNames({ displayName: 'Maya', partnerName: 'Sam' });
      s.toggleGoal('romance');
      s.confirmGoals();
      s.setKeyDates({ birthday: '1990-05-09' }, true);
      s.setStep(step);
    };
    const NEW_ACCOUNT = () => {
      const now = Date.now();
      return {
        created_at: new Date(now - 60_000).toISOString(),
        last_sign_in_at: new Date(now).toISOString(),
      };
    };
    beforeEach(() => cacheStorage.removeItem('query-cache'));
    afterEach(() => {
      useOnboarding.getState().reset();
      usePendingSetup.getState().reset();
    });

    it('a kill mid-quiz resumes at that step with every answer; Back follows the order', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
      await fireEvent.press(screen.getByTestId('01-start'));
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/stage'));
      await fireEvent.press(screen.getByTestId('05-dating'));
      await fireEvent.press(screen.getByTestId('05-next'));
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/names'));
      await fireEvent.changeText(screen.getByTestId('07-me'), 'Alex');
      await fireEvent.changeText(screen.getByTestId('07-partner'), 'Sam');
      await fireEvent.press(screen.getByTestId('07-next'));
      await waitFor(() => expect(r.getPathname()).toBe('/story/1'));
      await fireEvent.press(screen.getByTestId('02-next'));
      await waitFor(() => expect(r.getPathname()).toBe('/story/2'));
      await fireEvent.press(screen.getByTestId('03-this_month'));
      expect(onDisk()).toBeDefined();

      killAndRelaunch();
      const r2 = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r2.getPathname()).toBe('/story/2'));
      expect(screen.getByTestId('03-title')).toHaveTextContent(
        'When did you last learn something new about Sam?',
      );
      expect(screen.getByRole('radio', { name: /^This month/ })).toBeChecked();
      // Nothing behind it after the relaunch: Back goes to the previous step, the Dating 02.
      await fireEvent.press(screen.getByTestId('03-top-back'));
      await waitFor(() => expect(r2.getPathname()).toBe('/story/1'));
      expect(screen.getByTestId('02-dating')).toBeTruthy();
      // Back moves the resume point too.
      killAndRelaunch();
      const r3 = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r3.getPathname()).toBe('/story/1'));
      expect(mockSetupCalls).toEqual([]);
    }, 20000);

    it('a resume point saved at 47 opens T1 (MOB-69); sign-in (08) resumes too, never P3', async () => {
      keepQuiz('/plan/moment');
      // An older build saved the resume point at 47, which is no longer an onboarding step.
      const saved = JSON.parse(onDisk() ?? '{}') as Record<string, unknown>;
      secureStore().set(KEY, JSON.stringify({ ...saved, step: '/quiz/dates' }));
      killAndRelaunch();
      expect(useOnboarding.getState().step).toBe('/plan/first-question');
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/plan/first-question'));
      expect(await screen.findByTestId('T1-screen')).toBeTruthy();
      expect(useOnboarding.getState().keyDates).toEqual({ birthday: '1990-05-09' });
      await fireEvent.press(screen.getByTestId('T1-top-back'));
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/goals'));

      useOnboarding.getState().setStep('/plan/trial');
      // P3 without a RevenueCat key steps aside to 08: the quiz is over from here on.
      const r2 = await renderRouter(APP_DIR, { initialUrl: '/plan/trial' });
      await waitFor(() => expect(r2.getPathname()).toBe('/sign-in'));
      killAndRelaunch();
      expect(useOnboarding.getState().step).toBe('/sign-in');
      const r3 = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r3.getPathname()).toBe('/sign-in'));
      expect(screen.getByText('Save your bond')).toBeTruthy();
    });

    it('back on 01 starts at 01 again; a fresh phone writes nothing', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
      await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
      expect(onDisk()).toBeUndefined();
      keepQuiz('/welcome');
      killAndRelaunch();
      const r2 = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r2.getPathname()).toBe('/welcome'));
      // The answers are still there for the next Get started.
      expect(useOnboarding.getState().stage).toBe('dating');
    });

    it('after sign-in the kept quiz is written once, then cleared from the phone', async () => {
      declineSoftAsk();
      keepQuiz('/sign-in');
      usePendingSetup.getState().setFirstAnswer('FIXTURE-T1 kept');
      killAndRelaunch();
      mockUser = { userId: 'u1' };
      mockCouple = null;
      mockAccountTimes = NEW_ACCOUNT();
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/invite'), { timeout: 3000 });
      expect(mockCreateCouple).toHaveBeenCalledTimes(1);
      expect(mockCreateCouple).toHaveBeenCalledWith({
        stage: 'dating',
        goals: ['romance'],
        partnerName: 'Sam',
      });
      expect(mockUpsertKeyDates).toHaveBeenLastCalledWith([
        expect.objectContaining({ kind: 'birthday', date: '1990-05-09' }),
      ]);
      expect(mockSetupCalls).toEqual(['onboarding_answers', 'get_daily_question', 'answer']);
      expect(onDisk()).toBeUndefined();
      expect(useOnboarding.getState()).toMatchObject({ stage: null, step: null, displayName: '' });
      // A relaunch has nothing left to write.
      killAndRelaunch();
      await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(mockCreateCouple).toHaveBeenCalledTimes(1));
    }, 15000);

    it('ALREADY_PAIRED clears the kept quiz and T1 like a finished setup', async () => {
      keepQuiz('/sign-in');
      usePendingSetup.getState().setFirstAnswer('FIXTURE-T1 paired');
      mockUser = { userId: 'u1' };
      mockCouple = null;
      mockAccountTimes = NEW_ACCOUNT();
      mockAlreadyPaired = {
        ...SOLO,
        couple_members: [
          { user_id: 'u1', left_at: null },
          { user_id: 'u2', left_at: null },
        ],
      };
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/today'), { timeout: 3000 });
      expect(onDisk()).toBeUndefined();
      expect(useOnboarding.getState().stage).toBeNull();
      expect(usePendingSetup.getState().firstAnswer).toBeNull();
      expect(mockSaveFirstAnswer).not.toHaveBeenCalled();
      // Once: the setup is not run again from `/`.
      expect(mockCreateCouple).toHaveBeenCalledTimes(1);
    }, 15000);

    it('a signed-in returning user is unaffected: Today, and a stale kept quiz is dropped', async () => {
      keepQuiz('/quiz/goals');
      killAndRelaunch();
      mockUser = { userId: 'u1' };
      mockCouple = {
        ...SOLO,
        couple_members: [
          { user_id: 'u1', left_at: null },
          { user_id: 'u2', left_at: null },
        ],
      };
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
      await waitFor(() => expect(onDisk()).toBeUndefined());
      expect(mockCreateCouple).not.toHaveBeenCalled();
      // Later without a couple (the partner left): 58 or setup as before, never the old quiz.
      mockCouple = null;
      mockEnded = null;
      cacheStorage.removeItem('query-cache');
      const r2 = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r2.getPathname()).toBe('/reminders'));
    });

    it('a brand-new account killed mid-quiz (D40) resumes the quiz, not the setup', async () => {
      keepQuiz('/quiz/goals');
      killAndRelaunch();
      mockUser = { userId: 'u1' };
      mockCouple = null;
      mockAccountTimes = NEW_ACCOUNT();
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/goals'));
      expect(screen.getByRole('checkbox', { name: 'Romance' })).toBeChecked();
      expect(mockCreateCouple).not.toHaveBeenCalled();
    });
  });

  describe('D50 onboarding (MOB-60)', () => {
    beforeEach(() => useOnboarding.getState().reset());
    afterEach(() => useOnboarding.getState().reset());

    // The visible "n/4" (the bar itself carries the spoken "Step n of 4").
    const progress = (id: string) =>
      within(screen.getByTestId(`${id}-top`)).getByText(/^\d\/4$/, { includeHiddenElements: true })
        .props.children as string;

    it('walks 01 → 05 → 07 → 02 → 03 → 04 → 06 → 47 → T1 → N → L → P2 → sign-in, keeping answers locally', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
      await fireEvent.press(screen.getByTestId('01-start'));

      // 05 Your stage, 1/4. The stage is required: Continue explains instead of moving on.
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/stage'));
      expect(progress('05')).toBe('1/4');
      expect(screen.getByLabelText('Step 1 of 4')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('05-next'));
      expect(screen.getByTestId('05-missing')).toBeTruthy();
      expect(r.getPathname()).toBe('/quiz/stage');
      await fireEvent.press(screen.getByTestId('05-dating'));
      expect(screen.getByTestId('05-dating-check', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Dating' })).toBeChecked();
      await fireEvent.press(screen.getByTestId('05-next'));

      // 07 Your names, 2/4 (asked early so the story can name the partner).
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/names'));
      expect(progress('07')).toBe('2/4');
      await fireEvent.press(screen.getByTestId('07-next'));
      expect(screen.getByTestId('07-missing')).toBeTruthy();
      await fireEvent.changeText(screen.getByTestId('07-me'), 'Alex');
      await fireEvent.changeText(screen.getByTestId('07-partner'), 'Sam');
      expect(screen.getByTestId('07-bond-starts')).toHaveTextContent('Your bond starts on day 1');
      await fireEvent.press(screen.getByTestId('07-next'));

      // 02 the Dating story, naming Sam. No quiz progress, story dots.
      await waitFor(() => expect(r.getPathname()).toBe('/story/1'));
      expect(screen.getByTestId('02-dating')).toBeTruthy();
      expect(screen.getByText('Life gets busy.')).toBeTruthy();
      expect(screen.getByTestId('02-body')).toHaveTextContent(
        'New plans, full calendars. You and Sam text all day and still wonder what they really think.',
      );
      expect(screen.queryByTestId('02-progress')).toBeNull();
      expect(screen.getByTestId('02-dots')).toBeTruthy();
      // #37: the mascot describes this screen, not a partner's answer.
      expect(
        screen.getByLabelText('Bao and Bun, waiting for a quiet moment together.'),
      ).toBeTruthy();
      await fireEvent.press(screen.getByTestId('02-next'));

      // 03 the private question about Sam, 3/4.
      await waitFor(() => expect(r.getPathname()).toBe('/story/2'));
      expect(progress('03')).toBe('3/4');
      expect(screen.getByTestId('03-title')).toHaveTextContent(
        'When did you last learn something new about Sam?',
      );
      expect(screen.getByTestId('03-private')).toHaveTextContent(
        'Just for you. Sam never sees this.',
      );
      expect(
        screen.getByRole('radio', { name: 'This week. We still surprise each other' }),
      ).toBeTruthy();
      await fireEvent.press(screen.getByTestId('03-this_month'));
      expect(useOnboarding.getState().lastLearned).toBe('this_month');
      await fireEvent.press(screen.getByTestId('03-next'));

      // 04 the payoff: an everyday example question, two revealed cards and reaction pills.
      await waitFor(() => expect(r.getPathname()).toBe('/story/3'));
      expect(screen.queryByTestId('04-progress')).toBeNull();
      expect(screen.getByTestId('04-question')).toHaveTextContent(
        'What’s a small thing I do that makes your day better?',
      );
      expect(screen.queryByText('What did you notice first about Sam?')).toBeNull();
      expect(within(screen.getByTestId('04-partner-card')).getByText('Sam')).toBeTruthy();
      expect(within(screen.getByTestId('04-my-card')).getByText('Alex')).toBeTruthy();
      expect(screen.getByLabelText('Reacted with red heart, selected, 1')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('04-reaction-1'));
      expect(screen.getByTestId('04-reaction-1')).toBeSelected();
      expect(screen.getByTestId('04-psychology')).toHaveTextContent(
        'Made with relationship psychology',
      );
      await fireEvent.press(screen.getByTestId('04-next'));

      // 06 goal chips, 4/4, with the line naming the picks in the board's order.
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/goals'));
      expect(progress('06')).toBe('4/4');
      expect(screen.queryByTestId('06-summary')).toBeNull();
      await fireEvent.press(screen.getByTestId('06-learning'));
      await fireEvent.press(screen.getByTestId('06-deep_talks'));
      await fireEvent.press(screen.getByTestId('06-laughing'));
      expect(screen.getByRole('checkbox', { name: 'Deep talks' })).toBeChecked();
      expect(screen.getByTestId('06-summary')).toHaveTextContent(
        '3 picked. We’ll start with deep talks, laughs and learning about each other.',
      );
      await fireEvent.press(screen.getByTestId('06-next'));

      // Straight on to T1 (MOB-69: 47 key dates is not part of onboarding).
      await waitFor(() => expect(r.getPathname()).toBe('/plan/first-question'));
      await fireEvent.changeText(screen.getByTestId('T1-field'), 'FIXTURE-T1 walk');
      await fireEvent.press(screen.getByTestId('T1-submit'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/moment'));
      await fireEvent.press(screen.getByTestId('N-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/building'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/yours'), { timeout: 6000 });
      await fireEvent.press(screen.getByTestId('P2-start'));
      await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
      // 06 was 4 of 4: sign-in shows no quiz progress any more.
      expect(screen.queryByTestId('08-progress')).toBeNull();
      expect(useOnboarding.getState()).toMatchObject({
        stage: 'dating',
        lastLearned: 'this_month',
        goals: ['learning', 'deep_talks', 'laughing'],
        displayName: 'Alex',
        partnerName: 'Sam',
        keyDates: {},
        remindWeekBefore: true,
      });
    }, 15000);

    it('back follows the order: 06 → 04 → 03 → 02 → 07 → 05 → 01', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
      await fireEvent.press(screen.getByTestId('01-start'));
      await fireEvent.press(await screen.findByTestId('05-living_together'));
      await fireEvent.press(screen.getByTestId('05-next'));
      await fireEvent.changeText(await screen.findByTestId('07-me'), 'Alex');
      await fireEvent.changeText(screen.getByTestId('07-partner'), 'Sam');
      await fireEvent.press(screen.getByTestId('07-next'));
      await fireEvent.press(await screen.findByTestId('02-next'));
      await fireEvent.press(await screen.findByTestId('03-next'));
      await fireEvent.press(await screen.findByTestId('04-next'));
      await waitFor(() => expect(r.getPathname()).toBe('/quiz/goals'));
      const order: [string, string][] = [
        ['06', '/story/3'],
        ['04', '/story/2'],
        ['03', '/story/1'],
        ['02', '/quiz/names'],
        ['07', '/quiz/stage'],
        ['05', '/welcome'],
      ];
      for (const [id, previous] of order) {
        await fireEvent.press(screen.getByTestId(`${id}-top-back`));
        await waitFor(() => expect(r.getPathname()).toBe(previous));
      }
    });

    it.each([
      ['/quiz/goals', '06', '/story/3'],
      ['/story/3', '04', '/story/2'],
      ['/story/2', '03', '/story/1'],
      ['/story/1', '02', '/quiz/names'],
      ['/quiz/names', '07', '/quiz/stage'],
      ['/quiz/stage', '05', '/welcome'],
    ])('opened directly, back on %s goes to the previous step', async (url, id, previous) => {
      const r = await renderRouter(APP_DIR, { initialUrl: url });
      await fireEvent.press(await screen.findByTestId(`${id}-top-back`));
      await waitFor(() => expect(r.getPathname()).toBe(previous));
    });

    it('progress: 05 1/4, 07 2/4, 03 3/4, 06 4/4; 02 and 04 show none', async () => {
      for (const [url, id, label] of [
        ['/quiz/stage', '05', '1/4'],
        ['/quiz/names', '07', '2/4'],
        ['/story/2', '03', '3/4'],
        ['/quiz/goals', '06', '4/4'],
      ] as const) {
        await renderRouter(APP_DIR, { initialUrl: url });
        expect(progress(id)).toBe(label);
        expect(screen.getByTestId(`${id}-progress`)).toBeTruthy();
      }
      for (const [url, id] of [
        ['/story/1', '02'],
        ['/story/3', '04'],
      ] as const) {
        await renderRouter(APP_DIR, { initialUrl: url });
        expect(screen.getByTestId(`${id}-screen`)).toBeTruthy();
        expect(screen.queryByTestId(`${id}-progress`)).toBeNull();
      }
    });

    it.each([
      [
        'dating',
        'Life gets busy.',
        'New plans, full calendars. You and Sam text all day and still wonder what they really think.',
        'Free Friday?',
      ],
      [
        'living_together',
        'Life gets loud.',
        'Work, chores, screens. You and Sam talk all day and still miss each other.',
        'Did you get milk?',
      ],
      [
        'engaged_married',
        'Life gets full.',
        'Plans, family, lists. You and Sam share everything and still miss each other.',
        'Did you call the venue?',
      ],
      [
        'long_distance',
        'Miles get loud.',
        'Time zones and short calls. You and Sam talk every day and still miss each other.',
        'Call tonight?',
      ],
    ] as const)(
      '02 for %s: its own title, bubbles and body naming the partner',
      async (stage, title, body, bubble) => {
        useOnboarding.getState().setStage(stage);
        useOnboarding.getState().setNames({ displayName: 'Alex', partnerName: ' Sam ' });
        await renderRouter(APP_DIR, { initialUrl: '/story/1' });
        expect(screen.getByTestId(`02-${stage}`)).toBeTruthy();
        expect(screen.getByText(title)).toBeTruthy();
        expect(screen.getByTestId('02-body')).toHaveTextContent(body);
        // The bubbles pop in one by one.
        expect(
          await screen.findByText(bubble, { includeHiddenElements: true }, { timeout: 2000 }),
        ).toBeTruthy();
      },
    );

    it('02 without a stage is the living-together version; no name reads "your partner"', async () => {
      await renderRouter(APP_DIR, { initialUrl: '/story/1' });
      expect(screen.getByTestId('02-living_together')).toBeTruthy();
      expect(screen.getByTestId('02-body')).toHaveTextContent(
        'Work, chores, screens. You and your partner talk all day and still miss each other.',
      );
    });

    it('03 and 04 name the partner from 07, with fallbacks when it is empty', async () => {
      useOnboarding.getState().setNames({ displayName: 'Alex', partnerName: 'maya' });
      await renderRouter(APP_DIR, { initialUrl: '/story/2' });
      expect(screen.getByTestId('03-title')).toHaveTextContent(
        'When did you last learn something new about maya?',
      );
      // A sentence starts with the name: capitalised there.
      expect(screen.getByTestId('03-private')).toHaveTextContent(
        'Just for you. Maya never sees this.',
      );
      useOnboarding.getState().setNames({ displayName: '', partnerName: '' });
      await renderRouter(APP_DIR, { initialUrl: '/story/2' });
      expect(screen.getByTestId('03-title')).toHaveTextContent(
        'When did you last learn something new about your partner?',
      );
      expect(screen.getByTestId('03-private')).toHaveTextContent(
        'Just for you. Your partner never sees this.',
      );
      await renderRouter(APP_DIR, { initialUrl: '/story/3' });
      expect(within(screen.getByTestId('04-partner-card')).getByText('Your partner')).toBeTruthy();
      expect(within(screen.getByTestId('04-my-card')).getByText('You')).toBeTruthy();
    });

    it('06 with nothing picked shows no summary and still records "none" (v2 goals [])', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/quiz/goals' });
      expect(screen.queryByTestId('06-summary')).toBeNull();
      await fireEvent.press(screen.getByTestId('06-romance'));
      expect(screen.getByTestId('06-summary')).toHaveTextContent(
        '1 picked. We’ll start with romance.',
      );
      await fireEvent.press(screen.getByTestId('06-romance'));
      expect(screen.queryByTestId('06-summary')).toBeNull();
      await fireEvent.press(screen.getByTestId('06-next'));
      await waitFor(() => expect(r.getPathname()).toBe('/plan/first-question'));
      expect(useOnboarding.getState().goals).toEqual([]);
      expect(useOnboarding.getState().answeredAt.goals).toEqual(expect.any(String));
    });

    it('D40 unchanged: "I already have an account" on 01 skips every onboarding step', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
      await fireEvent.press(screen.getByTestId('01-sign-in'));
      await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
      for (const id of ['05', '07', '02', '03', '04', '06']) {
        expect(screen.queryByTestId(`${id}-screen`)).toBeNull();
      }
    });
  });

  describe('pairing (MOB-09)', () => {
    const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
    const preview = jest.mocked(invitePreview);
    const accept = jest.mocked(acceptInvite);
    const PAIRED_RESULT = { kind: 'paired' as const, coupleId: 'couple-1' };
    const MAYA = {
      inviterName: 'Maya',
      inviterAvatarUrl: null,
      inviterAnsweredToday: true,
      expiresAt: '2999-01-01T00:00:00Z',
    };

    beforeEach(() => {
      preview.mockReset();
      accept.mockReset();
      useMyInvite.getState().set(null);
    });

    it('J3: a link without a token fills the code, previews the inviter and goes on to sign-in', async () => {
      preview.mockResolvedValue(MAYA);
      const r = await renderRouter(APP_DIR, { initialUrl: '/j/BND4827' });
      await waitFor(() => expect(screen.getByTestId('join-code-found')).toBeTruthy());
      expect(r.getPathname()).toBe('/join/code');
      expect(preview).toHaveBeenCalledTimes(1);
      expect(preview).toHaveBeenCalledWith('4827', null);
      expect(screen.getByText("You're joining Maya")).toBeTruthy();
      expect(screen.getByText("Maya has already answered today's question.")).toBeTruthy();
      expect(usePendingInvite.getState().inviterName).toBe('Maya');
      // No signed URL (typed code or Edge fallback): the initial.
      expect(screen.getByTestId('join-code-avatar-initial')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('join-code-continue'));
      await waitFor(() => expect(r.getPathname()).toBe('/join/sign-in'));
    });

    it('J3: a remembered link token with a signed avatar shows it on the found card (MOB-35)', async () => {
      const signed = 'https://dev.supabase.co/storage/v1/object/sign/avatars/u1/avatar.jpg?t=x';
      preview.mockResolvedValue({ ...MAYA, inviterAvatarUrl: signed });
      usePendingInvite.getState().set({ code: '4827', token: TOKEN });
      await renderRouter(APP_DIR, { initialUrl: '/join/code?code=4827' });
      expect(await screen.findByTestId('join-code-avatar-image')).toBeTruthy();
      expect(preview).toHaveBeenCalledWith('4827', TOKEN);
      // The signed URL stays in the screen only, never in the remembered invite.
      expect(JSON.stringify(usePendingInvite.getState())).not.toContain(signed);
    });

    it('J3: a typed code is previewed without a token', async () => {
      preview.mockResolvedValue(MAYA);
      await renderRouter(APP_DIR, { initialUrl: '/join/code' });
      await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
      await waitFor(() => expect(preview).toHaveBeenCalledWith('4827', null));
    });

    it('J9: a wrong code shows the error, Try again clears it, Start my own leaves', async () => {
      preview.mockRejectedValue(new AppError('INVALID_CODE', 'No match for that code.'));
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/code' });
      await fireEvent.changeText(screen.getByTestId('join-code-input'), '1111');
      await waitFor(() => expect(screen.getByText('No match for that code.')).toBeTruthy());
      expect(screen.getByTestId('join-code-error')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('join-code-retry'));
      expect(screen.queryByText('No match for that code.')).toBeNull();
      await fireEvent.changeText(screen.getByTestId('join-code-input'), '2222');
      await waitFor(() => expect(screen.getByTestId('join-code-own')).toBeTruthy());
      await fireEvent.press(screen.getByTestId('join-code-own'));
      await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    });

    it('56: an expired invite says so and asks for a new code', async () => {
      preview.mockRejectedValue(new AppError('INVITE_EXPIRED', 'Expired.'));
      await renderRouter(APP_DIR, { initialUrl: '/join/code' });
      await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
      await waitFor(() => expect(screen.getByText('This invite has expired')).toBeTruthy());
      expect(screen.queryByTestId('join-code-input')).toBeNull();
      expect(screen.getByTestId('56-expired')).toBeTruthy();
    });

    it.each([
      ['/join/code', 'J3', 'join-code-continue'],
      ['/join', '12', 'join-code-retry'],
    ])(
      '%s (%s): the number pad goes away once the code is complete, so %s is reachable (#27)',
      async (url, id, button) => {
        mockUser = id === '12' ? { userId: 'u2' } : null;
        mockCouple = null;
        preview.mockResolvedValue(MAYA);
        accept.mockRejectedValue(new AppError('INVALID_CODE', 'No match for that code.'));
        const dismiss = jest.spyOn(Keyboard, 'dismiss');
        try {
          await renderRouter(APP_DIR, { initialUrl: url });
          expect(screen.getByTestId('join-code-keyboard')).toBeTruthy();
          await fireEvent.changeText(screen.getByTestId('join-code-input'), '482');
          expect(dismiss).not.toHaveBeenCalled();
          await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
          expect(await screen.findByTestId(button)).toBeTruthy();
          expect(dismiss).toHaveBeenCalledTimes(1);
        } finally {
          dismiss.mockRestore();
        }
      },
    );

    it('56 (#37): shows the expired code, asks for a new one by plain text, or takes another code', async () => {
      preview.mockRejectedValue(new AppError('INVITE_EXPIRED', 'Expired.'));
      const share = jest
        .spyOn(Share, 'share')
        .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
      try {
        await renderRouter(APP_DIR, { initialUrl: '/join/code' });
        await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
        expect(await screen.findByTestId('56-code')).toHaveTextContent('Code BND·4827 expired');
        expect(screen.getByText(/Ask your partner for a fresh one/)).toBeTruthy();
        await fireEvent.press(screen.getByTestId('56-ask'));
        expect(share).toHaveBeenCalledWith({
          message: 'My Bonded invite code BND·4827 expired. Can you send me a new one?',
        });
        expect(screen.getByTestId('56-ask')).toHaveTextContent('Ask your partner for a new code');
        await fireEvent.press(screen.getByTestId('join-code-retry'));
        expect(await screen.findByTestId('join-code-input')).toBeTruthy();
      } finally {
        share.mockRestore();
      }
    });

    it('J10 (#37): names the inviter when known; signed in, it goes back to my own space', async () => {
      mockUser = { userId: 'u1' };
      usePendingInvite.getState().set({ code: '4827', token: null, inviterName: 'maya' });
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/full' });
      expect(await screen.findByText('Maya is already bonded')).toBeTruthy();
      expect(screen.getByText(/Ask maya to check Couple settings/)).toBeTruthy();
      await fireEvent.press(screen.getByTestId('J10-own'));
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
      expect(usePendingInvite.getState().code).toBeNull();
    });

    it('J10: a full couple goes to the already-bonded screen', async () => {
      preview.mockRejectedValue(new AppError('COUPLE_FULL', 'Full.'));
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/code' });
      await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
      await waitFor(() => expect(r.getPathname()).toBe('/join/full'));
    });

    it('J2: without an invite in memory it falls back to the code screen', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    });

    it('J2: with the inviter known it greets by name', async () => {
      preview.mockReturnValue(new Promise(() => undefined));
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      expect(screen.getByText('Maya saved you a seat')).toBeTruthy();
    });

    it('J2: content and both buttons sit in a scroll view, so 200% text reaches them (#105)', async () => {
      preview.mockResolvedValue(MAYA);
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      const scroll = within(screen.getByTestId('J2-scroll'));
      expect(scroll.getByText('Maya saved you a seat')).toBeTruthy();
      expect(scroll.getByTestId('J2-join')).toBeTruthy();
      expect(scroll.getByTestId('J2-no')).toBeTruthy();
      expect(screen.getByTestId('J2-scroll').props.contentContainerStyle).toMatchObject({
        flexGrow: 1,
        justifyContent: 'space-between',
      });
    });

    it('J2: the offline retry state scrolls too (#105)', async () => {
      preview.mockRejectedValue(new AppError('NETWORK', 'Offline.'));
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: null });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      expect(await screen.findByTestId('J2-retry')).toBeTruthy();
      const scroll = within(screen.getByTestId('J2-scroll'));
      expect(scroll.getByTestId('J2-retry')).toBeTruthy();
      expect(scroll.getByTestId('J2-no')).toBeTruthy();
    });

    it('J2: a link shows the inviter pill with the signed avatar (MOB-35)', async () => {
      const signed = 'https://dev.supabase.co/storage/v1/object/sign/avatars/u1/avatar.jpg?t=x';
      preview.mockResolvedValue({ ...MAYA, inviterAvatarUrl: signed });
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      expect(await screen.findByTestId('J2-avatar-image')).toBeTruthy();
      expect(preview).toHaveBeenCalledTimes(1);
      expect(preview).toHaveBeenCalledWith('4827', TOKEN);
      expect(screen.getByTestId('J2-inviter').props.accessibilityLabel).toBe('Maya invited you');
    });

    it('J2: when only the avatar fails (Edge fallback) the pill keeps the initial', async () => {
      preview.mockResolvedValue(MAYA);
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('J2-avatar-initial')).toBeTruthy();
      expect(screen.queryByTestId('J2-avatar-image')).toBeNull();
    });

    it('J2: offline with the name already known, the pill keeps the initial', async () => {
      preview.mockRejectedValue(new AppError('NETWORK', 'Offline.'));
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Maya saved you a seat')).toBeTruthy();
      expect(screen.getByTestId('J2-avatar-initial')).toBeTruthy();
    });

    it('J2: a typed code (no token) shows the initial without calling the preview', async () => {
      usePendingInvite.getState().set({ code: '4827', token: null, inviterName: 'Maya' });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      expect(screen.getByTestId('J2-avatar-initial')).toBeTruthy();
      expect(preview).not.toHaveBeenCalled();
    });

    it('J5: needs a name, then joins with the code and token, then J6, then You are paired', async () => {
      mockUser = { userId: 'u2' };
      // A joiner with no couple of their own (no D37 confirmation); the join gives them one.
      mockCouple = null;
      accept.mockImplementation(() => {
        mockCouple = SOLO;
        return Promise.resolve(PAIRED_RESULT);
      });
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/name' });
      await fireEvent.press(screen.getByTestId('J5-join'));
      expect(accept).not.toHaveBeenCalled();
      await fireEvent.changeText(screen.getByTestId('J5-name'), 'Sam');
      await fireEvent.press(screen.getByTestId('J5-join'));
      await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
      expect(accept).toHaveBeenCalledWith('4827', TOKEN, { archiveOwn: false });
      await fireEvent.press(await screen.findByTestId('J6-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/paired'));
      expect(usePendingInvite.getState().code).toBeNull();
    });

    it('J5: the joiner goes on to J6 and 13, never back to an empty J3 (#26)', async () => {
      mockUser = { userId: 'u2' };
      // A joiner with no couple of their own (no D37 confirmation); the join gives them one.
      mockCouple = null;
      accept.mockImplementation(() => {
        mockCouple = SOLO;
        return Promise.resolve(PAIRED_RESULT);
      });
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/name' });
      // On a phone the refetch after the join takes a while: hold it open, as the network would.
      let release: () => void = () => undefined;
      const slow = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = QueryClient.prototype.invalidateQueries;
      const spy = jest
        .spyOn(QueryClient.prototype, 'invalidateQueries')
        .mockImplementation(function (this: QueryClient, ...args) {
          return slow.then(() => original.apply(this, args));
        });
      try {
        await fireEvent.changeText(screen.getByTestId('J5-name'), 'Sam');
        await fireEvent.press(screen.getByTestId('J5-join'));
        await waitFor(() =>
          expect(accept).toHaveBeenCalledWith('4827', TOKEN, { archiveOwn: false }),
        );
        await act(async () => {
          await Promise.resolve();
        });
        // While the caches refresh, J5 stays put instead of bouncing to the code screen.
        expect(r.getPathname()).toBe('/join/name');
        expect(screen.queryByTestId('J3-screen')).toBeNull();
        await act(async () => {
          release();
          await slow;
        });
      } finally {
        spy.mockRestore();
      }
      await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
      expect(screen.queryByTestId('J3-screen')).toBeNull();
      await fireEvent.press(await screen.findByTestId('J6-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/paired'));
      expect(await screen.findByTestId('13-screen')).toBeTruthy();
      expect(usePendingInvite.getState().code).toBeNull();
    });

    it('J5: a code that died on the way sends the person back to the code screen', async () => {
      mockUser = { userId: 'u2' };
      mockCouple = null;
      accept.mockRejectedValue(new AppError('INVITE_EXPIRED', 'Expired.'));
      usePendingInvite.getState().set({ code: '4827', token: null, inviterName: 'Maya' });
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/name' });
      await fireEvent.changeText(screen.getByTestId('J5-name'), 'Sam');
      await fireEvent.press(screen.getByTestId('J5-join'));
      await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    });

    it('12: a signed-in person joins by code and lands on You are paired', async () => {
      mockUser = { userId: 'u2' };
      // A joiner with no couple of their own (no D37 confirmation); the join gives them one.
      mockCouple = null;
      accept.mockImplementation(() => {
        mockCouple = SOLO;
        return Promise.resolve(PAIRED_RESULT);
      });
      const r = await renderRouter(APP_DIR, { initialUrl: '/join' });
      await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
      await waitFor(() => expect(r.getPathname()).toBe('/paired'));
      expect(accept).toHaveBeenCalledWith('4827', null, { archiveOwn: false });
    });

    it('10: shows the code card, then moves to You are paired once the partner has joined', async () => {
      mockUser = { userId: 'u1' };
      const r = await renderRouter(APP_DIR, { initialUrl: '/invite' });
      await waitFor(() => expect(screen.getByTestId('10-code')).toBeTruthy());
      expect(screen.getByText('BND·4827')).toBeTruthy();
      mockCouple = {
        id: 'couple-1',
        couple_members: [
          { user_id: 'u1', left_at: null },
          { user_id: 'u2', left_at: null },
        ],
      };
      // The inviter's screen polls every 5 s as a fallback for a dropped realtime socket.
      await waitFor(() => expect(r.getPathname()).toBe('/paired'), { timeout: 9000 });
    }, 15_000);

    const PAIRED = {
      id: 'couple-1',
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
    };

    it('11: moves to You are paired when realtime reports the partner joined (opened by link)', async () => {
      mockUser = { userId: 'u1' };
      const r = await renderRouter(APP_DIR, { initialUrl: '/waiting' });
      expect(await screen.findByTestId('11-screen')).toBeTruthy();
      // The pairing layout subscribes once the couple id is known.
      await waitFor(() => expect(mockRealtime.handlers.has('couple_members')).toBe(true));
      mockCouple = PAIRED;
      await act(async () => {
        mockRealtime.emit('couple_members', {
          new: { couple_id: 'couple-1', user_id: 'u2', left_at: null },
        });
      });
      // Well under the 5 s poll: only the realtime invalidation can get there in time.
      await waitFor(() => expect(r.getPathname()).toBe('/paired'), { timeout: 1000 });
      expect(await screen.findByTestId('13-screen')).toBeTruthy();
    });

    it('11: still moves to You are paired by polling when realtime is silent and the app is inactive (opened from 10)', async () => {
      mockUser = { userId: 'u1' };
      const r = await renderRouter(APP_DIR, { initialUrl: '/invite' });
      await fireEvent.press(await screen.findByTestId('10-later'));
      await waitFor(() => expect(r.getPathname()).toBe('/waiting'));
      expect(await screen.findByTestId('11-screen')).toBeTruthy();
      // iOS reports "inactive" while a system sheet is up; the poll must not pause for it.
      await act(async () => focusManager.setFocused(false));
      try {
        mockCouple = PAIRED;
        // No realtime event: the 5 s poll is the only way forward.
        await waitFor(() => expect(r.getPathname()).toBe('/paired'), { timeout: 9000 });
      } finally {
        await act(async () => focusManager.setFocused(undefined));
      }
    }, 15_000);

    describe('token links open J2 first (MOB-40, D06)', () => {
      const SIGNED = 'https://dev.supabase.co/storage/v1/object/sign/avatars/u1/avatar.jpg?t=x';
      const LINK = `/j/BND4827?t=${TOKEN}`;

      beforeEach(() => {
        // A cached couple from an earlier test would turn the joiner solo (D37 sheet).
        cacheStorage.removeItem('query-cache');
      });
      afterEach(() => {
        // The persistence test goes offline; never leak that into later tests.
        onlineManager.setOnline(true);
      });

      it('cold start: J2 greets by name with the signed avatar, asking once with the token', async () => {
        preview.mockResolvedValue({ ...MAYA, inviterAvatarUrl: SIGNED });
        const r = await renderRouter(APP_DIR, { initialUrl: LINK });
        expect(await screen.findByTestId('J2-screen')).toBeTruthy();
        expect(r.getPathname()).toBe('/join/welcome');
        expect(screen.getByText('Maya saved you a seat')).toBeTruthy();
        expect(await screen.findByTestId('J2-avatar-image')).toBeTruthy();
        expect(preview).toHaveBeenCalledTimes(1);
        expect(preview).toHaveBeenCalledWith('4827', TOKEN);
        expect(usePendingInvite.getState()).toMatchObject({
          code: '4827',
          token: TOKEN,
          inviterName: 'Maya',
        });
        expect(JSON.stringify(usePendingInvite.getState())).not.toContain(SIGNED);
        expect(screen.queryByTestId('J3-screen')).toBeNull();
      });

      it('warm: a link opened while the app runs goes to J2, forgetting the name of an older code', async () => {
        preview.mockResolvedValue(MAYA);
        usePendingInvite.getState().set({ code: '1111', token: null, inviterName: 'Robin' });
        const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
        expect(await screen.findByTestId('01-screen')).toBeTruthy();
        await act(async () => router.push(LINK));
        await waitFor(() => expect(r.getPathname()).toBe('/join/welcome'));
        expect(await screen.findByText('Maya saved you a seat')).toBeTruthy();
        expect(screen.queryByText(/Robin/)).toBeNull();
        expect(usePendingInvite.getState()).toMatchObject({ code: '4827', token: TOKEN });
        expect(preview).toHaveBeenCalledWith('4827', TOKEN);
      });

      it('J2 -> J4 sign-in -> J5, then joins with the code and token', async () => {
        mockCouple = null;
        preview.mockResolvedValue(MAYA);
        accept.mockImplementation(() => {
          mockCouple = SOLO;
          return Promise.resolve(PAIRED_RESULT);
        });
        const r = await renderRouter(APP_DIR, { initialUrl: LINK });
        await fireEvent.press(await screen.findByTestId('J2-join'));
        await waitFor(() => expect(r.getPathname()).toBe('/join/sign-in'));
        expect(await screen.findByTestId('J4-screen')).toBeTruthy();
        expect(screen.getByText(/Maya/)).toBeTruthy();
        await fireEvent.press(screen.getByTestId('J4-email'));
        await fireEvent.changeText(screen.getByTestId('J4-email-field'), 'sam@example.test');
        await fireEvent.press(screen.getByTestId('J4-send-code'));
        await fireEvent.changeText(await screen.findByTestId('J4-code-field'), '123456');
        await fireEvent.press(screen.getByTestId('J4-verify'));
        await waitFor(() => expect(r.getPathname()).toBe('/join/name'));
        expect(await screen.findByTestId('J5-screen')).toBeTruthy();
        expect(screen.getByText('What should Maya call you?')).toBeTruthy();
        await fireEvent.changeText(screen.getByTestId('J5-name'), 'Sam');
        await fireEvent.press(screen.getByTestId('J5-join'));
        await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
        expect(accept).toHaveBeenCalledWith('4827', TOKEN, { archiveOwn: false });
        // One preview for the whole flow: J4 and J5 read the remembered name.
        expect(preview).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['INVALID_CODE', 'join-code-error'],
        ['INVITE_EXPIRED', '56-expired'],
      ] as const)(
        'J2: %s opens the existing J3 state (%s) without asking again',
        async (kind, testID) => {
          preview.mockRejectedValue(new AppError(kind, 'Nope.'));
          const r = await renderRouter(APP_DIR, { initialUrl: LINK });
          expect(await screen.findByTestId(testID)).toBeTruthy();
          expect(r.getPathname()).toBe('/join/code');
          expect(screen.getByTestId('J3-screen')).toBeTruthy();
          // The link counts once against the failed-attempt limiter.
          expect(preview).toHaveBeenCalledTimes(1);
          expect(screen.queryByTestId('J2-screen')).toBeNull();
        },
      );

      it('J2: a full couple goes to J10', async () => {
        preview.mockRejectedValue(new AppError('COUPLE_FULL', 'Full.'));
        const r = await renderRouter(APP_DIR, { initialUrl: LINK });
        await waitFor(() => expect(r.getPathname()).toBe('/join/full'));
        expect(await screen.findByTestId('J10-screen')).toBeTruthy();
      });

      it('J2: offline before the name is known shows an error with Try again', async () => {
        preview.mockRejectedValueOnce(new AppError('NETWORK', 'You seem to be offline.'));
        preview.mockResolvedValueOnce(MAYA);
        await renderRouter(APP_DIR, { initialUrl: LINK });
        expect(await screen.findByTestId('J2-error')).toBeTruthy();
        expect(screen.getByText('You seem to be offline.')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('J2-retry'));
        expect(await screen.findByText('Maya saved you a seat')).toBeTruthy();
        expect(preview).toHaveBeenCalledTimes(2);
      });

      it('J2: "This invite isn\'t for me" forgets the invite and goes to 01', async () => {
        preview.mockResolvedValue(MAYA);
        const r = await renderRouter(APP_DIR, { initialUrl: LINK });
        await fireEvent.press(await screen.findByTestId('J2-no'));
        await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
        expect(usePendingInvite.getState()).toMatchObject({ code: null, token: null });
      });

      it('a typed code still goes to J3, never J2', async () => {
        preview.mockResolvedValue(MAYA);
        const r = await renderRouter(APP_DIR, { initialUrl: '/join/code' });
        await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
        expect(await screen.findByTestId('join-code-found')).toBeTruthy();
        expect(preview).toHaveBeenCalledWith('4827', null);
        expect(r.getPathname()).toBe('/join/code');
        expect(screen.queryByTestId('J2-screen')).toBeNull();
      });

      it('D37: signed in and solo, J2 -> J5 without sign-in, confirms, then joins with the token', async () => {
        mockUser = { userId: 'u1' };
        preview.mockResolvedValue(MAYA);
        accept.mockImplementation(() => {
          mockCouple = PAIRED;
          return Promise.resolve({ kind: 'paired' as const, coupleId: 'couple-2' });
        });
        const r = await renderRouter(APP_DIR, { initialUrl: LINK });
        await fireEvent.press(await screen.findByTestId('J2-join'));
        await waitFor(() => expect(r.getPathname()).toBe('/join/name'));
        await fireEvent.changeText(await screen.findByTestId('J5-name'), 'Alex');
        await fireEvent.press(screen.getByTestId('J5-join'));
        expect(await screen.findByTestId('J5-confirm')).toBeTruthy();
        expect(accept).not.toHaveBeenCalled();
        await fireEvent.press(screen.getByTestId('J5-confirm-confirm'));
        await waitFor(() =>
          expect(accept).toHaveBeenCalledWith('4827', TOKEN, { archiveOwn: true }),
        );
        await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
      });

      it('D37: signed in, "This invite isn\'t for me" goes back to my own space', async () => {
        mockUser = { userId: 'u1' };
        preview.mockResolvedValue(MAYA);
        const r = await renderRouter(APP_DIR, { initialUrl: LINK });
        await fireEvent.press(await screen.findByTestId('J2-no'));
        await waitFor(() => expect(r.getPathname()).toBe('/today'));
      });

      it('the token never reaches persisted storage, online or offline', async () => {
        mockUser = { userId: 'u1' };
        preview.mockResolvedValue({ ...MAYA, inviterAvatarUrl: SIGNED });
        // Online: J2 with the signed avatar, while the signed-in person's couple is cached.
        await renderRouter(APP_DIR, { initialUrl: LINK });
        expect(await screen.findByTestId('J2-avatar-image')).toBeTruthy();
        // Offline: J3 with the remembered token previews at once instead of pausing (a paused
        // mutation would be persisted with the token in its variables).
        await act(async () => onlineManager.setOnline(false));
        await renderRouter(APP_DIR, { initialUrl: '/join/code?code=4827' });
        expect(await screen.findByTestId('join-code-found')).toBeTruthy();
        expect(preview).toHaveBeenLastCalledWith('4827', TOKEN);
        // The persister writes at most once a second (trailing): wait for a write after this.
        cacheStorage.removeItem('query-cache');
        await act(async () => onlineManager.setOnline(true));
        await waitFor(() => expect(cacheStorage.getItem('query-cache')).toBeTruthy(), {
          timeout: 5000,
        });
        const stored = cacheStorage.getItem('query-cache');
        expect(stored).not.toContain(TOKEN);
        expect(stored).not.toContain(SIGNED);
      }, 20_000);
    });

    describe('pending join: typed codes wait for the inviter (MOB-32, BE-26)', () => {
      const PENDING = { kind: 'pending' as const, requestId: 'req-1', expiresAt: FUTURE };

      // The persisted query cache would bring back an earlier test's couple (and the D37 sheet).
      beforeEach(() => cacheStorage.removeItem('query-cache'));

      it('J5: a typed code waits for Maya, then moves on to J6 when she approves', async () => {
        mockUser = { userId: 'u2' };
        mockCouple = null;
        accept.mockResolvedValue(PENDING);
        usePendingInvite.getState().set({ code: '4827', token: null, inviterName: 'Maya' });
        const r = await renderRouter(APP_DIR, { initialUrl: '/join/name' });
        await fireEvent.changeText(screen.getByTestId('J5-name'), 'Sam');
        await fireEvent.press(screen.getByTestId('J5-join'));
        await waitFor(() => expect(r.getPathname()).toBe('/join/pending'));
        expect(await screen.findByTestId('12-join-pending-waiting')).toBeTruthy();
        expect(screen.getByText('Waiting for Maya to confirm')).toBeTruthy();
        expect(screen.getByLabelText('Bao and Bun, waiting for Maya to confirm.')).toBeTruthy();
        // Nothing is paired yet, and the typed code is no longer a pending invite.
        expect(usePendingInvite.getState().code).toBeNull();
        expect(usePendingJoin.getState().pending).toMatchObject({
          requestId: 'req-1',
          code: '4827',
        });
        await waitFor(() => expect(mockRealtime.handlers.has('join_requests')).toBe(true));
        mockMyRequest = { status: 'approved', expiresAt: FUTURE };
        mockCouple = PAIRED;
        await act(async () => {
          mockRealtime.emit('join_requests', { new: { id: 'req-1', status: 'approved' } });
        });
        // Well under the 5 s couple poll and 10 s request poll: the realtime signal got there.
        await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'), { timeout: 2000 });
      });

      it('12: a typed code waits; a decline shows its state and a way back to the code', async () => {
        mockUser = { userId: 'u2' };
        mockCouple = null;
        accept.mockResolvedValue(PENDING);
        const r = await renderRouter(APP_DIR, { initialUrl: '/join' });
        await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
        await waitFor(() => expect(r.getPathname()).toBe('/join/pending'));
        expect(accept).toHaveBeenCalledWith('4827', null, { archiveOwn: false });
        // 12 has no preview, so no name: neutral copy.
        expect(await screen.findByText('Waiting for your partner to confirm')).toBeTruthy();
        await waitFor(() => expect(mockRealtime.handlers.has('join_requests')).toBe(true));
        mockMyRequest = { status: 'declined', expiresAt: FUTURE };
        await act(async () => {
          mockRealtime.emit('join_requests', { new: { id: 'req-1', status: 'declined' } });
        });
        expect(await screen.findByTestId('12-join-pending-declined')).toBeTruthy();
        expect(screen.getByText("Your partner didn't confirm")).toBeTruthy();
        // Declined: no "Ask again" (the server would answer JOIN_REQUEST_FORBIDDEN).
        expect(screen.queryByTestId('12-join-pending-ask-again')).toBeNull();
        await fireEvent.press(screen.getByTestId('12-join-pending-other-code'));
        await waitFor(() => expect(r.getPathname()).toBe('/join'));
        expect(usePendingJoin.getState().pending).toBeNull();
      });

      it('expired: says so and "Ask again" sends a new request with the same code', async () => {
        mockUser = { userId: 'u2' };
        mockCouple = null;
        mockMyRequest = { status: 'pending', expiresAt: '2000-01-01T00:00:00Z' };
        usePendingJoin.getState().set({
          requestId: 'req-old',
          expiresAt: '2000-01-01T00:00:00Z',
          code: '4827',
          inviterName: 'Maya',
          origin: 'J5',
        });
        accept.mockResolvedValue({ kind: 'pending', requestId: 'req-2', expiresAt: FUTURE });
        await renderRouter(APP_DIR, { initialUrl: '/join/pending' });
        // Still "pending" in the row, but past expires_at: lazy expiry reads as expired.
        expect(await screen.findByTestId('12-join-pending-expired')).toBeTruthy();
        expect(screen.getByText('Nobody confirmed in time')).toBeTruthy();
        mockMyRequest = { status: 'pending', expiresAt: FUTURE };
        await fireEvent.press(screen.getByTestId('12-join-pending-ask-again'));
        await waitFor(() =>
          expect(accept).toHaveBeenCalledWith('4827', null, { archiveOwn: false }),
        );
        expect(await screen.findByTestId('12-join-pending-waiting')).toBeTruthy();
        // The name from the first request is kept.
        expect(screen.getByText('Waiting for Maya to confirm')).toBeTruthy();
      });

      it('expired, then "Ask again" after a decline: explains they already said no', async () => {
        mockUser = { userId: 'u2' };
        mockCouple = null;
        mockMyRequest = { status: 'expired', expiresAt: FUTURE };
        usePendingJoin.getState().set({
          requestId: 'req-old',
          expiresAt: FUTURE,
          code: '4827',
          inviterName: 'Maya',
          origin: 'J5',
        });
        accept.mockRejectedValue(new AppError('JOIN_REQUEST_FORBIDDEN', 'raw'));
        await renderRouter(APP_DIR, { initialUrl: '/join/pending' });
        await fireEvent.press(await screen.findByTestId('12-join-pending-ask-again'));
        expect(await screen.findByTestId('12-join-pending-error')).toBeTruthy();
        expect(
          screen.getByText(
            'Maya already said no to this code. Ask them for a new code or their invite link.',
          ),
        ).toBeTruthy();
      });

      it('expired, "Ask again" answered CONFIRM_ARCHIVE: the D37 sheet opens; only its confirm sends the flag (MOB-48)', async () => {
        mockUser = { userId: 'u2' };
        mockCouple = null;
        mockMyRequest = { status: 'expired', expiresAt: FUTURE };
        usePendingJoin.getState().set({
          requestId: 'req-old',
          expiresAt: FUTURE,
          code: '4827',
          inviterName: 'Maya',
          origin: 'J5',
        });
        accept.mockRejectedValueOnce(new AppError('CONFIRM_ARCHIVE', 'raw'));
        await renderRouter(APP_DIR, { initialUrl: '/join/pending' });
        await fireEvent.press(await screen.findByTestId('12-join-pending-ask-again'));
        expect(await screen.findByTestId('12-join-pending-confirm-confirm')).toBeTruthy();
        expect(accept).toHaveBeenCalledTimes(1);
        expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: false });
        // The sheet asks; no error banner, no retry with the flag by itself.
        expect(screen.queryByTestId('12-join-pending-error')).toBeNull();

        // Cancel keeps everything: nothing else is sent.
        await fireEvent.press(screen.getByTestId('12-join-pending-confirm-cancel'));
        await waitFor(() =>
          expect(screen.queryByTestId('12-join-pending-confirm-confirm')).toBeNull(),
        );
        expect(accept).toHaveBeenCalledTimes(1);

        // Ask again -> CONFIRM_ARCHIVE again -> confirm sends p_archive_own.
        accept.mockRejectedValueOnce(new AppError('CONFIRM_ARCHIVE', 'raw'));
        await fireEvent.press(screen.getByTestId('12-join-pending-ask-again'));
        const confirm = await screen.findByTestId('12-join-pending-confirm-confirm');
        expect(accept).toHaveBeenCalledTimes(2);
        expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: false });
        accept.mockResolvedValue({ kind: 'pending', requestId: 'req-2', expiresAt: FUTURE });
        mockMyRequest = { status: 'pending', expiresAt: FUTURE };
        await fireEvent.press(confirm);
        await waitFor(() => expect(accept).toHaveBeenCalledTimes(3));
        expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: true });
        expect(await screen.findByTestId('12-join-pending-waiting')).toBeTruthy();
        expect(usePendingJoin.getState().pending).toMatchObject({ requestId: 'req-2' });
        await waitFor(() =>
          expect(screen.queryByTestId('12-join-pending-confirm-confirm')).toBeNull(),
        );
      });

      it.each([
        ['JOIN_REQUEST_FORBIDDEN', /^Your partner already said no to this code/],
        ['RATE_LIMITED', /^This code has too many requests right now/],
      ] as const)('12: %s from accept_invite gets joiner copy', async (kind, text) => {
        mockUser = { userId: 'u2' };
        mockCouple = null;
        accept.mockRejectedValue(new AppError(kind, 'raw'));
        await renderRouter(APP_DIR, { initialUrl: '/join' });
        await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
        expect(await screen.findByText(text)).toBeTruthy();
      });

      it('/join/pending without a request in memory goes back to the start', async () => {
        mockUser = { userId: 'u1' };
        const r = await renderRouter(APP_DIR, { initialUrl: '/join/pending' });
        await waitFor(() => expect(r.getPathname()).toBe('/today'));
      });

      it('10: the inviter sees who is asking (their typed name, as a question) and approves', async () => {
        mockUser = { userId: 'u1' };
        mockPendingRequests = [{ requestId: 'r1', requesterName: 'Sam', expiresAt: FUTURE }];
        mockApproveJoin.mockImplementation(() => {
          mockCouple = PAIRED;
          return Promise.resolve('couple-1');
        });
        const r = await renderRouter(APP_DIR, { initialUrl: '/invite' });
        expect(await screen.findByTestId('10-join-request')).toBeTruthy();
        expect(screen.getByText('Sam wants to join you')).toBeTruthy();
        expect(screen.getByText(/called themselves Sam\. Is this your partner\?/)).toBeTruthy();
        expect(screen.queryByText(/verified/i)).toBeNull();
        await fireEvent.press(screen.getByTestId('10-join-request-approve'));
        await waitFor(() => expect(mockApproveJoin).toHaveBeenCalledWith('r1'));
        await waitFor(() => expect(r.getPathname()).toBe('/paired'), { timeout: 2000 });
        expect(mockDeclineJoin).not.toHaveBeenCalled();
      });

      it('11: an empty name gets neutral copy; Not my partner declines and the card goes', async () => {
        mockUser = { userId: 'u1' };
        mockPendingRequests = [{ requestId: 'r2', requesterName: '', expiresAt: FUTURE }];
        mockDeclineJoin.mockImplementation(() => {
          mockPendingRequests = [];
          return Promise.resolve();
        });
        const r = await renderRouter(APP_DIR, { initialUrl: '/waiting' });
        expect(await screen.findByTestId('11-join-request')).toBeTruthy();
        expect(screen.getByText('Someone wants to join you')).toBeTruthy();
        expect(screen.getByText(/didn't add a name/)).toBeTruthy();
        await fireEvent.press(screen.getByTestId('11-join-request-decline'));
        await waitFor(() => expect(mockDeclineJoin).toHaveBeenCalledWith('r2'));
        await waitFor(() => expect(screen.queryByTestId('11-join-request')).toBeNull());
        expect(mockApproveJoin).not.toHaveBeenCalled();
        expect(r.getPathname()).toBe('/waiting');
      });

      it('10: a join_requests Realtime event refetches the list and the card appears', async () => {
        mockUser = { userId: 'u1' };
        await renderRouter(APP_DIR, { initialUrl: '/invite' });
        expect(await screen.findByTestId('10-code')).toBeTruthy();
        expect(screen.queryByTestId('10-join-request')).toBeNull();
        await waitFor(() => expect(mockRealtime.handlers.has('join_requests')).toBe(true));
        mockPendingRequests = [{ requestId: 'r3', requesterName: 'Sam', expiresAt: FUTURE }];
        await act(async () => {
          mockRealtime.emit('join_requests', { new: { id: 'r3', couple_id: 'couple-1' } });
        });
        // Under the 10 s poll: only the Realtime invalidation gets there.
        expect(await screen.findByTestId('10-join-request', {}, { timeout: 1000 })).toBeTruthy();
      });

      it('10: an approval that timed out says so', async () => {
        mockUser = { userId: 'u1' };
        mockPendingRequests = [{ requestId: 'r4', requesterName: 'Sam', expiresAt: FUTURE }];
        mockApproveJoin.mockRejectedValue(new AppError('JOIN_REQUEST_EXPIRED', 'Timed out.'));
        await renderRouter(APP_DIR, { initialUrl: '/invite' });
        await fireEvent.press(await screen.findByTestId('10-join-request-approve'));
        expect(await screen.findByTestId('10-join-request-error')).toBeTruthy();
        expect(screen.getByText('Timed out.')).toBeTruthy();
      });

      it('10: a request past its expiry is not shown', async () => {
        mockUser = { userId: 'u1' };
        mockPendingRequests = [
          { requestId: 'r5', requesterName: 'Sam', expiresAt: '2000-01-01T00:00:00Z' },
        ];
        await renderRouter(APP_DIR, { initialUrl: '/invite' });
        expect(await screen.findByTestId('10-code')).toBeTruthy();
        expect(screen.queryByTestId('10-join-request')).toBeNull();
      });

      it('Today: a solo inviter sees the request above the invite card', async () => {
        mockUser = { userId: 'u1' };
        mockPendingRequests = [{ requestId: 'r6', requesterName: 'Sam', expiresAt: FUTURE }];
        await renderRouter(APP_DIR, { initialUrl: '/today' });
        expect(await screen.findByTestId('today-join-request')).toBeTruthy();
        expect(screen.getByTestId('today-join-request-approve')).toBeTruthy();
      });
    });

    describe('D36: the shared code is never replaced silently (MOB-33)', () => {
      const OPEN = { code: '5150', expiresAt: '2999-01-01T00:00:00Z', acceptedAt: null };

      // The query cache is persisted (MMKV) between renders: start each test without an invite in it.
      beforeEach(() => cacheStorage.removeItem('query-cache'));

      it('10 after a restart (no token in memory) shows the open code and does NOT call create_invite', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = OPEN;
        await renderRouter(APP_DIR, { initialUrl: '/invite' });
        expect(await screen.findByText('BND·5150')).toBeTruthy();
        // The code only shows once the open invite has loaded, which is when 10 would create one.
        expect(mockCreateInvite).not.toHaveBeenCalled();
        expect(screen.getByTestId('10-code-card').props.accessibilityLabel).toBe(
          'Your couple code, B N D, 5 1 5 0',
        );
      });

      it('10 with no open invite makes exactly one', async () => {
        mockUser = { userId: 'u1' };
        await renderRouter(APP_DIR, { initialUrl: '/invite' });
        expect(await screen.findByText('BND·4827')).toBeTruthy();
        expect(mockCreateInvite).toHaveBeenCalledTimes(1);
      });

      it('10 with an expired open invite makes a new one once', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = { ...OPEN, expiresAt: '2000-01-01T00:00:00Z' };
        await renderRouter(APP_DIR, { initialUrl: '/invite' });
        expect(await screen.findByText('BND·4827')).toBeTruthy();
        expect(mockCreateInvite).toHaveBeenCalledTimes(1);
      });

      it('10 "Make a new code" asks first; cancel keeps the code', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = OPEN;
        await renderRouter(APP_DIR, { initialUrl: '/invite' });
        expect(await screen.findByText('BND·5150')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('10-new'));
        expect(await screen.findByTestId('10-new-confirm')).toBeTruthy();
        expect(screen.getByText(/Your current code BND·5150 will stop working/)).toBeTruthy();
        await fireEvent.press(screen.getByTestId('10-new-confirm-cancel'));
        await waitFor(() => expect(screen.queryByTestId('10-new-confirm')).toBeNull());
        expect(mockCreateInvite).not.toHaveBeenCalled();
        expect(screen.getByText('BND·5150')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('10-new'));
        await fireEvent.press(await screen.findByTestId('10-new-confirm-confirm'));
        expect(await screen.findByText('BND·4827')).toBeTruthy();
        expect(mockCreateInvite).toHaveBeenCalledTimes(1);
      });

      it('#38: no invite token reaches the console or the persisted cache while making and sharing', async () => {
        mockUser = { userId: 'u1' };
        mockCreateInvite.mockImplementationOnce(() => {
          mockOpenInvite = OPEN;
          return Promise.resolve({ ...OPEN, token: 'SECRET-CREATE-TOKEN' });
        });
        mockInviteLink.mockResolvedValue({ ...OPEN, token: 'SECRET-LINK-TOKEN' });
        const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
        const spies = methods.map((m) => jest.spyOn(console, m));
        const share = jest
          .spyOn(Share, 'share')
          .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
        try {
          await renderRouter(APP_DIR, { initialUrl: '/invite' });
          expect(await screen.findByText('BND·5150')).toBeTruthy();
          await fireEvent.press(screen.getByTestId('10-share'));
          await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
          // The token was shared (that is the point), but nowhere else.
          expect(JSON.stringify(share.mock.calls)).toContain('SECRET-CREATE-TOKEN');
          // A fresh visit without the token in memory: invite_link's token is shared, not logged.
          useMyInvite.getState().set(null);
          await renderRouter(APP_DIR, { initialUrl: '/invite' });
          expect(await screen.findByText('BND·5150')).toBeTruthy();
          await fireEvent.press(screen.getByTestId('10-share'));
          await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
          expect(JSON.stringify(share.mock.calls[1])).toContain('SECRET-LINK-TOKEN');
          for (const spy of spies) {
            expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SECRET-(CREATE|LINK)-TOKEN/);
          }
          // The throttled persister (1 s) writes the cache; then check what is on "disk".
          await waitFor(() => expect(cacheStorage.getItem('query-cache')).toBeTruthy(), {
            timeout: 4000,
          });
          expect(cacheStorage.getItem('query-cache') ?? '').not.toMatch(
            /SECRET-(CREATE|LINK)-TOKEN/,
          );
        } finally {
          share.mockRestore();
          spies.forEach((spy) => spy.mockRestore());
        }
      });

      it('10 Share without a token asks invite_link for the same code, never create_invite', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = OPEN;
        mockInviteLink.mockResolvedValue({ ...OPEN, token: 'linktok' });
        const share = jest
          .spyOn(Share, 'share')
          .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
        try {
          await renderRouter(APP_DIR, { initialUrl: '/invite' });
          expect(await screen.findByText('BND·5150')).toBeTruthy();
          await fireEvent.press(screen.getByTestId('10-share'));
          await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
          const { message } = share.mock.calls[0]?.[0] as { message: string };
          expect(message).toContain('BND·5150');
          expect(message).toContain('BND5150?t=linktok');
          // The token is kept in memory: sharing again doesn't use up another link.
          await fireEvent.press(screen.getByTestId('10-share'));
          await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
          expect(mockInviteLink).toHaveBeenCalledTimes(1);
          expect(mockCreateInvite).not.toHaveBeenCalled();
        } finally {
          share.mockRestore();
        }
      });

      it.each([
        ['returns null', () => mockInviteLink.mockResolvedValue(null)],
        [
          'fails (RATE_LIMITED)',
          () => mockInviteLink.mockRejectedValue(new AppError('RATE_LIMITED', 'Slow down.')),
        ],
      ])('10 Share falls back to the code alone when invite_link %s', async (_label, arrange) => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = OPEN;
        arrange();
        const share = jest
          .spyOn(Share, 'share')
          .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
        try {
          await renderRouter(APP_DIR, { initialUrl: '/invite' });
          expect(await screen.findByText('BND·5150')).toBeTruthy();
          await fireEvent.press(screen.getByTestId('10-share'));
          await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
          const { message } = share.mock.calls[0]?.[0] as { message: string };
          expect(message).toContain('join with code BND·5150');
          expect(message).not.toContain('t=');
          expect(mockCreateInvite).not.toHaveBeenCalled();
        } finally {
          share.mockRestore();
        }
      });

      it('Today while solo shows the open code with Copy, Share (-> 10) and Join them', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = OPEN;
        const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
        expect(await screen.findByTestId('today-invite-card')).toBeTruthy();
        expect(screen.getByText('Waiting for Sam · BND·5150')).toBeTruthy();
        expect(
          within(screen.getByTestId('today-invite-card')).getByLabelText(
            'Waiting for Sam. Your couple code, B N D, 5 1 5 0',
          ),
        ).toBeTruthy();
        expect(screen.getByTestId('today-join-partner')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('today-invite-share'));
        await waitFor(() => expect(r.getPathname()).toBe('/invite'));
        expect(await screen.findByText('BND·5150')).toBeTruthy();
        expect(mockCreateInvite).not.toHaveBeenCalled();
      });

      it('Today says when the code expired and offers a new one (-> 10)', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = { ...OPEN, expiresAt: '2000-01-01T00:00:00Z' };
        const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
        expect(await screen.findByTestId('today-invite-card-expired')).toBeTruthy();
        expect(screen.getByText('Your code BND·5150 expired')).toBeTruthy();
        expect(mockCreateInvite).not.toHaveBeenCalled();
        await fireEvent.press(screen.getByTestId('today-invite-new'));
        await waitFor(() => expect(r.getPathname()).toBe('/invite'));
        expect(await screen.findByText('BND·4827')).toBeTruthy();
      });

      it('Today hides the card (and Join them) once the partner joins', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = OPEN;
        await renderRouter(APP_DIR, { initialUrl: '/today' });
        expect(await screen.findByTestId('today-invite-card')).toBeTruthy();
        await waitFor(() => expect(mockRealtime.handlers.has('couple_members')).toBe(true));
        mockCouple = PAIRED;
        await act(async () => {
          mockRealtime.emit('couple_members', {
            new: { couple_id: 'couple-1', user_id: 'u2', left_at: null },
          });
        });
        await waitFor(() => expect(screen.queryByTestId('today-invite-card')).toBeNull());
        expect(screen.queryByTestId('today-join-partner')).toBeNull();
      });

      it('Today never shows the card for a paired couple', async () => {
        mockUser = { userId: 'u1' };
        mockCouple = PAIRED;
        mockOpenInvite = OPEN;
        await renderRouter(APP_DIR, { initialUrl: '/today' });
        expect(await screen.findByTestId('18-screen')).toBeTruthy();
        expect(screen.queryByTestId('today-invite-card')).toBeNull();
        expect(screen.queryByTestId('today-invite-card-loading')).toBeNull();
        expect(screen.queryByTestId('today-join-partner')).toBeNull();
      });
    });

    describe('D37: a solo account joins a partner later (MOB-33)', () => {
      it.each([
        ['/invite', '10-join-partner'],
        ['/waiting', '11-join-partner'],
        ['/today', 'today-join-partner'],
      ])('%s offers %s while solo', async (url, testID) => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = { code: '5150', expiresAt: '2999-01-01T00:00:00Z', acceptedAt: null };
        const r = await renderRouter(APP_DIR, { initialUrl: url });
        await fireEvent.press(await screen.findByTestId(testID));
        await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
        expect(await screen.findByTestId('J3-screen')).toBeTruthy();
      });

      it('ships with the D37 entries on (MOB-33b)', () => {
        const flags = jest.requireActual<{ JOIN_FROM_SOLO_ENABLED: boolean }>(
          '@/features/pairing/flags',
        );
        expect(flags.JOIN_FROM_SOLO_ENABLED).toBe(true);
      });

      it('with the kill switch off none of the entries show', async () => {
        mockUser = { userId: 'u1' };
        mockOpenInvite = { code: '5150', expiresAt: '2999-01-01T00:00:00Z', acceptedAt: null };
        mockFlags.JOIN_FROM_SOLO_ENABLED = false;
        try {
          await renderRouter(APP_DIR, { initialUrl: '/today' });
          expect(await screen.findByTestId('today-invite-card')).toBeTruthy();
          expect(screen.queryByTestId('today-join-partner')).toBeNull();
          await renderRouter(APP_DIR, { initialUrl: '/invite' });
          expect(await screen.findByText('BND·5150')).toBeTruthy();
          expect(screen.queryByTestId('10-join-partner')).toBeNull();
          await renderRouter(APP_DIR, { initialUrl: '/waiting' });
          expect(await screen.findByTestId('11-screen')).toBeTruthy();
          expect(screen.queryByTestId('11-join-partner')).toBeNull();
        } finally {
          mockFlags.JOIN_FROM_SOLO_ENABLED = true;
        }
      });

      it('signed in and solo: code -> J5 without sign-in; joining asks first and Cancel keeps everything', async () => {
        mockUser = { userId: 'u1' };
        preview.mockResolvedValue(MAYA);
        accept.mockImplementation(() => {
          mockCouple = PAIRED;
          return Promise.resolve({ kind: 'paired' as const, coupleId: 'couple-2' });
        });
        const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
        await fireEvent.press(await screen.findByTestId('today-join-partner'));
        await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
        await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
        await fireEvent.press(await screen.findByTestId('join-code-continue'));
        await waitFor(() => expect(r.getPathname()).toBe('/join/name'));
        expect(await screen.findByTestId('J5-screen')).toBeTruthy();
        await fireEvent.changeText(screen.getByTestId('J5-name'), 'Alex');
        await fireEvent.press(screen.getByTestId('J5-join'));
        expect(await screen.findByTestId('J5-confirm')).toBeTruthy();
        expect(screen.getByText('Join Maya?')).toBeTruthy();
        expect(screen.getByText(/archived: read-only for 30 days/)).toBeTruthy();
        expect(screen.getByText(/Your own invite code stops working/)).toBeTruthy();
        await fireEvent.press(screen.getByTestId('J5-confirm-cancel'));
        await waitFor(() => expect(screen.queryByTestId('J5-confirm')).toBeNull());
        expect(accept).not.toHaveBeenCalled();
        expect(r.getPathname()).toBe('/join/name');
        await fireEvent.press(screen.getByTestId('J5-join'));
        await fireEvent.press(await screen.findByTestId('J5-confirm-confirm'));
        await waitFor(() =>
          expect(accept).toHaveBeenCalledWith('4827', null, { archiveOwn: true }),
        );
        await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
      });

      describe('#112: only the D37 sheet confirms a solo join (MOB-44)', () => {
        async function openJ5Sheet() {
          mockUser = { userId: 'u1' };
          preview.mockResolvedValue(MAYA);
          accept.mockImplementation(() => {
            mockCouple = PAIRED;
            return Promise.resolve({ kind: 'paired' as const, coupleId: 'couple-2' });
          });
          const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
          await fireEvent.press(await screen.findByTestId('today-join-partner'));
          await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
          await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
          await fireEvent.press(await screen.findByTestId('join-code-continue'));
          await waitFor(() => expect(r.getPathname()).toBe('/join/name'));
          await fireEvent.changeText(await screen.findByTestId('J5-name'), 'Alex');
          await fireEvent(screen.getByTestId('J5-name'), 'submitEditing');
          expect(await screen.findByTestId('J5-confirm')).toBeTruthy();
          expect(accept).not.toHaveBeenCalled();
          return r;
        }

        it('Return on the name field while the sheet is open does not join', async () => {
          const r = await openJ5Sheet();
          await fireEvent(
            screen.getByTestId('J5-name', { includeHiddenElements: true }),
            'submitEditing',
          );
          await fireEvent(
            screen.getByTestId('J5-name', { includeHiddenElements: true }),
            'submitEditing',
          );
          await act(async () => {
            await Promise.resolve();
          });
          expect(accept).not.toHaveBeenCalled();
          expect(screen.getByTestId('J5-confirm')).toBeTruthy();
          expect(r.getPathname()).toBe('/join/name');
        });

        it('the J5 button behind the open sheet does not join', async () => {
          const r = await openJ5Sheet();
          await fireEvent.press(screen.getByTestId('J5-join', { includeHiddenElements: true }));
          await fireEvent.press(screen.getByTestId('J5-join', { includeHiddenElements: true }));
          await act(async () => {
            await Promise.resolve();
          });
          expect(accept).not.toHaveBeenCalled();
          expect(screen.getByTestId('J5-confirm')).toBeTruthy();
          expect(r.getPathname()).toBe('/join/name');
        });

        it("the sheet's Join joins exactly once", async () => {
          const r = await openJ5Sheet();
          await fireEvent.press(screen.getByTestId('J5-confirm-confirm'));
          await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
          expect(accept).toHaveBeenCalledTimes(1);
          expect(accept).toHaveBeenCalledWith('4827', null, { archiveOwn: true });
        });

        it("the sheet's Cancel does not join and closes the sheet", async () => {
          const r = await openJ5Sheet();
          await fireEvent.press(screen.getByTestId('J5-confirm-cancel'));
          await waitFor(() => expect(screen.queryByTestId('J5-confirm')).toBeNull());
          await fireEvent(screen.getByTestId('J5-name'), 'submitEditing');
          expect(await screen.findByTestId('J5-confirm')).toBeTruthy();
          await fireEvent.press(screen.getByTestId('J5-confirm-cancel'));
          await waitFor(() => expect(screen.queryByTestId('J5-confirm')).toBeNull());
          expect(accept).not.toHaveBeenCalled();
          expect(r.getPathname()).toBe('/join/name');
        });

        it('MOB-46: CONFIRM_ARCHIVE after the sheet confirm reopens it; only its confirm sends the flag', async () => {
          const r = await openJ5Sheet();
          accept.mockReset();
          accept
            .mockRejectedValueOnce(new AppError('CONFIRM_ARCHIVE', 'x'))
            .mockImplementation(() => {
              mockCouple = PAIRED;
              return Promise.resolve({ kind: 'paired' as const, coupleId: 'couple-2' });
            });
          await fireEvent.press(screen.getByTestId('J5-confirm-confirm'));
          await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
          expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: true });
          expect(await screen.findByTestId('J5-confirm')).toBeTruthy();
          expect(screen.queryByTestId('J5-error')).toBeNull();
          // Return and the button behind the reopened sheet still send nothing.
          await fireEvent(
            screen.getByTestId('J5-name', { includeHiddenElements: true }),
            'submitEditing',
          );
          await fireEvent.press(screen.getByTestId('J5-join', { includeHiddenElements: true }));
          await act(async () => {
            await Promise.resolve();
          });
          expect(accept).toHaveBeenCalledTimes(1);
          await fireEvent.press(screen.getByTestId('J5-confirm-confirm'));
          await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
          expect(accept).toHaveBeenCalledTimes(2);
          expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: true });
        });

        describe('the couple status must be known before any join', () => {
          let open: () => void = () => {};
          const hold = () => {
            mockCoupleGate = new Promise<void>((resolve) => {
              open = resolve;
            });
          };
          const flush = () =>
            act(async () => {
              await Promise.resolve();
            });

          beforeEach(() => {
            // Start with no cached couple, so the first read is the one we hold or fail.
            cacheStorage.removeItem('query-cache');
            mockUser = { userId: 'u1' };
            accept.mockResolvedValue({ kind: 'paired', coupleId: 'couple-2' });
          });
          afterEach(() => {
            mockCoupleGate = null;
            open();
          });

          it('J5: while the couple query is pending, Join and Return do not join', async () => {
            hold();
            usePendingInvite.getState().set({ code: '4827', token: null, inviterName: 'Maya' });
            await renderRouter(APP_DIR, { initialUrl: '/join/name' });
            await fireEvent.changeText(await screen.findByTestId('J5-name'), 'Alex');
            await fireEvent.press(screen.getByTestId('J5-join'));
            await fireEvent(screen.getByTestId('J5-name'), 'submitEditing');
            await flush();
            expect(accept).not.toHaveBeenCalled();
            expect(screen.queryByTestId('J5-confirm')).toBeNull();
            // The answer arrives (solo): nothing joins on its own; Join now asks first.
            mockCoupleGate = null;
            open();
            await flush();
            await waitFor(() =>
              expect(screen.getByTestId('J5-join').props.accessibilityState).toEqual(
                expect.objectContaining({ busy: false }),
              ),
            );
            expect(accept).not.toHaveBeenCalled();
            await fireEvent.press(screen.getByTestId('J5-join'));
            expect(await screen.findByTestId('J5-confirm')).toBeTruthy();
            expect(accept).not.toHaveBeenCalled();
          });

          it('J5: a failed couple query shows the retry banner, never joins, and retry works', async () => {
            mockCoupleError = new AppError('NETWORK', 'Network request failed');
            usePendingInvite.getState().set({ code: '4827', token: null, inviterName: 'Maya' });
            const r = await renderRouter(APP_DIR, { initialUrl: '/join/name' });
            await fireEvent.changeText(await screen.findByTestId('J5-name'), 'Alex');
            expect(
              await screen.findByTestId('J5-couple-error', {}, { timeout: 10_000 }),
            ).toBeTruthy();
            expect(screen.queryByTestId('J5-join')).toBeNull();
            await fireEvent(screen.getByTestId('J5-name'), 'submitEditing');
            await flush();
            expect(accept).not.toHaveBeenCalled();
            mockCoupleError = null;
            await fireEvent.press(screen.getByTestId('J5-couple-retry'));
            expect(await screen.findByTestId('J5-join')).toBeTruthy();
            expect(screen.queryByTestId('J5-couple-error')).toBeNull();
            await fireEvent.press(screen.getByTestId('J5-join'));
            await fireEvent.press(await screen.findByTestId('J5-confirm-confirm'));
            await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
            expect(accept).toHaveBeenCalledTimes(1);
          }, 30_000);

          it('J5: a cached solo couple opens the sheet at once, even while it refetches', async () => {
            preview.mockResolvedValue(MAYA);
            const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
            await fireEvent.press(await screen.findByTestId('today-join-partner'));
            await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
            hold();
            await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
            await fireEvent.press(await screen.findByTestId('join-code-continue'));
            await waitFor(() => expect(r.getPathname()).toBe('/join/name'));
            await fireEvent.changeText(await screen.findByTestId('J5-name'), 'Alex');
            await fireEvent.press(screen.getByTestId('J5-join'));
            expect(await screen.findByTestId('J5-confirm')).toBeTruthy();
            expect(accept).not.toHaveBeenCalled();
          });

          it('12: a complete code waits for the couple status, then asks first (solo)', async () => {
            hold();
            await renderRouter(APP_DIR, { initialUrl: '/join' });
            await fireEvent.changeText(await screen.findByTestId('join-code-input'), '4827');
            await flush();
            expect(screen.getByTestId('join-code-checking')).toBeTruthy();
            expect(screen.queryByTestId('12-confirm')).toBeNull();
            expect(accept).not.toHaveBeenCalled();
            mockCoupleGate = null;
            open();
            expect(await screen.findByTestId('12-confirm')).toBeTruthy();
            expect(accept).not.toHaveBeenCalled();
            await fireEvent.press(screen.getByTestId('12-confirm-confirm'));
            await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
          });

          it('12: a failed couple query shows the retry banner, never joins, and retry works', async () => {
            mockCoupleError = new AppError('NETWORK', 'Network request failed');
            await renderRouter(APP_DIR, { initialUrl: '/join' });
            await fireEvent.changeText(await screen.findByTestId('join-code-input'), '4827');
            expect(
              await screen.findByTestId('12-couple-error', {}, { timeout: 10_000 }),
            ).toBeTruthy();
            await flush();
            expect(screen.queryByTestId('12-confirm')).toBeNull();
            expect(accept).not.toHaveBeenCalled();
            mockCoupleError = null;
            await fireEvent.press(screen.getByTestId('12-couple-retry'));
            expect(await screen.findByTestId('12-confirm')).toBeTruthy();
            expect(screen.queryByTestId('12-couple-error')).toBeNull();
            expect(accept).not.toHaveBeenCalled();
            await fireEvent.press(screen.getByTestId('12-confirm-confirm'));
            await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
          }, 30_000);
        });

        it('12: re-entering the code while the sheet is open does not join', async () => {
          mockUser = { userId: 'u1' };
          accept.mockResolvedValue({ kind: 'paired', coupleId: 'couple-2' });
          await renderRouter(APP_DIR, { initialUrl: '/join' });
          await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
          expect(await screen.findByTestId('12-confirm')).toBeTruthy();
          const input = screen.getByTestId('join-code-input', { includeHiddenElements: true });
          await fireEvent.changeText(input, '482');
          await fireEvent.changeText(input, '4827');
          await act(async () => {
            await Promise.resolve();
          });
          expect(accept).not.toHaveBeenCalled();
          await fireEvent.press(screen.getByTestId('12-confirm-confirm'));
          await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
        });
      });

      it('12: a solo caller confirms before accept_invite; Cancel does not join', async () => {
        mockUser = { userId: 'u1' };
        accept.mockResolvedValue({ kind: 'paired', coupleId: 'couple-2' });
        await renderRouter(APP_DIR, { initialUrl: '/join' });
        await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
        expect(await screen.findByTestId('12-confirm')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('12-confirm-cancel'));
        await waitFor(() => expect(screen.queryByTestId('12-confirm')).toBeNull());
        expect(accept).not.toHaveBeenCalled();
      });

      describe('BE-35 archive consent only from the D37 sheet (MOB-46)', () => {
        const CONFIRM = new AppError('CONFIRM_ARCHIVE', 'x');

        it('12: the sheet confirm sends p_archive_own; CONFIRM_ARCHIVE reopens the sheet, no auto-retry', async () => {
          mockUser = { userId: 'u1' };
          accept.mockRejectedValueOnce(CONFIRM).mockResolvedValue({
            kind: 'paired',
            coupleId: 'couple-2',
          });
          const r = await renderRouter(APP_DIR, { initialUrl: '/join' });
          await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
          await fireEvent.press(await screen.findByTestId('12-confirm-confirm'));
          await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
          expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: true });
          // Stale consent on the server: the sheet asks again; nothing is sent on its own.
          expect(await screen.findByTestId('12-confirm')).toBeTruthy();
          await act(async () => {
            await Promise.resolve();
          });
          expect(accept).toHaveBeenCalledTimes(1);
          await fireEvent.press(screen.getByTestId('12-confirm-confirm'));
          await waitFor(() => expect(r.getPathname()).toBe('/paired'));
          expect(accept).toHaveBeenCalledTimes(2);
          expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: true });
        });

        it('12: Cancel on the reopened sheet sends nothing more', async () => {
          mockUser = { userId: 'u1' };
          accept.mockRejectedValue(CONFIRM);
          await renderRouter(APP_DIR, { initialUrl: '/join' });
          await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
          await fireEvent.press(await screen.findByTestId('12-confirm-confirm'));
          expect(await screen.findByTestId('12-confirm')).toBeTruthy();
          await fireEvent.press(screen.getByTestId('12-confirm-cancel'));
          await waitFor(() => expect(screen.queryByTestId('12-confirm')).toBeNull());
          expect(accept).toHaveBeenCalledTimes(1);
        });

        it('12 without a couple (not solo): no flag; a CONFIRM_ARCHIVE answer opens the sheet', async () => {
          mockUser = { userId: 'u2' };
          mockCouple = null;
          accept.mockRejectedValueOnce(CONFIRM).mockResolvedValue({
            kind: 'pending' as const,
            requestId: 'req-1',
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          });
          const r = await renderRouter(APP_DIR, { initialUrl: '/join' });
          await fireEvent.changeText(screen.getByTestId('join-code-input'), '4827');
          await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
          expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: false });
          expect(await screen.findByTestId('12-confirm')).toBeTruthy();
          expect(accept).toHaveBeenCalledTimes(1);
          await fireEvent.press(screen.getByTestId('12-confirm-confirm'));
          await waitFor(() => expect(r.getPathname()).toBe('/join/pending'));
          expect(accept).toHaveBeenLastCalledWith('4827', null, { archiveOwn: true });
        });
      });

      it('J9 for a signed-in solo person goes back to their own space, not onboarding', async () => {
        mockUser = { userId: 'u1' };
        preview.mockRejectedValue(new AppError('INVALID_CODE', 'No match for that code.'));
        const r = await renderRouter(APP_DIR, { initialUrl: '/join/code' });
        await fireEvent.changeText(screen.getByTestId('join-code-input'), '1111');
        expect(await screen.findByText('Back to my space')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('join-code-own'));
        await waitFor(() => expect(r.getPathname()).toBe('/today'));
      });
    });

    it('11: shows the day-1 question card and a mascot label about joining (#36)', async () => {
      mockUser = { userId: 'u1' };
      await renderRouter(APP_DIR, { initialUrl: '/waiting' });
      expect(await screen.findByTestId('11-question')).toBeTruthy();
      expect(screen.getByText("Day 1 · Today's question")).toBeTruthy();
      expect(screen.getByText('What made you smile?')).toBeTruthy();
      expect(
        screen.getByText("Your partner's answer appears here once you've both replied"),
      ).toBeTruthy();
      expect(
        screen.getByLabelText("Bao and Bun, waiting. Your partner hasn't joined yet."),
      ).toBeTruthy();
      expect(screen.queryByLabelText(/hasn't answered yet/)).toBeNull();
    });

    it('13: names both people', async () => {
      mockUser = { userId: 'u1' };
      await renderRouter(APP_DIR, { initialUrl: '/paired' });
      await waitFor(() => expect(screen.getByText(/Alex & Sam, you're bonded/)).toBeTruthy());
      // #37: the "Day 1" chip sits in its own wrapper so it centres with the title.
      expect(within(screen.getByTestId('13-day')).getByText('Day 1')).toBeTruthy();
    });
  });

  it('opens a token link on J2, remembering the token in memory (cold start, signed out; MOB-40)', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz012345';
    jest.mocked(invitePreview).mockReturnValue(new Promise(() => undefined));
    const r = await renderRouter(APP_DIR, { initialUrl: `/j/BND4827?t=${token}` });
    await waitFor(() => expect(r.getPathname()).toBe('/join/welcome'));
    expect(usePendingInvite.getState()).toMatchObject({ code: '4827', token });
    // Before the preview answers: a skeleton, no code screen.
    expect(screen.getByTestId('J2-loading')).toBeTruthy();
    expect(screen.queryByTestId('J3-screen')).toBeNull();
  });

  it('opens a malformed invite link on J3 without a code', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/j/nonsense' });
    await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    expect(r.getSearchParams()).toEqual({});
    expect(usePendingInvite.getState().code).toBeNull();
  });

  it('Today at AX5 on a small phone: the header scrolls with the body and the action is reachable (#66)', async () => {
    mockUser = { userId: 'u1' };
    mockCramped = true;
    await renderRouter(APP_DIR, { initialUrl: '/today' });
    const scroll = await screen.findByTestId('today-scroll');
    expect(await within(scroll).findByTestId('today-header')).toBeTruthy();
    expect(await within(scroll).findByTestId('18-answer')).toBeTruthy();
  });

  describe('Bao and Bun on Today (MOB-31, D32)', () => {
    // Host types of Today's mascots: 'View' = the animated rig, 'RNSVGSvgView' = a still pose.
    const mascots = () =>
      screen.queryAllByLabelText(/^Bao /).map((n) => (n as unknown as { type: string }).type);

    it('animate', async () => {
      mockUser = { userId: 'u1' };
      await renderRouter(APP_DIR, { initialUrl: '/today' });
      await waitFor(() => expect(mascots()).toContain('View'));
    });

    it('show the still pose with Reduce Motion', async () => {
      mockUser = { userId: 'u1' };
      const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
      try {
        await renderRouter(APP_DIR, { initialUrl: '/today' });
        await waitFor(() => expect(mascots()).toContain('RNSVGSvgView'));
        await waitFor(() => expect(mascots()).not.toContain('View'));
      } finally {
        reduce.mockRestore();
      }
    });
  });

  it('Today normally: header and action stay pinned around the scrolling body', async () => {
    mockUser = { userId: 'u1' };
    await renderRouter(APP_DIR, { initialUrl: '/today' });
    expect(await screen.findByTestId('18-answer')).toBeTruthy();
    const scroll = screen.getByTestId('today-scroll');
    expect(within(scroll).queryByTestId('today-header')).toBeNull();
    expect(within(scroll).queryByTestId('18-answer')).toBeNull();
  });

  describe('Us & settings (MOB-18)', () => {
    const PAIRED = {
      ...SOLO,
      paired_at: '2026-10-21T10:00:00Z',
      stage: 'long_distance',
      goals: ['deep_talks', 'romance', 'future'],
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
    };
    const PREFS = {
      ritual_time: '21:00:00',
      daily_reminder: true,
      partner_answered: true,
      replies: true,
      last_call: true,
      nudges: true,
      tips: false,
      quiet_start: '23:00:00',
      quiet_end: '07:00:00',
    };
    const ENDED = {
      id: 'couple-old',
      ended_at: new Date().toISOString(),
      paired_at: '2026-10-21T10:00:00Z',
      ended_by: 'u2',
      ended_reason: 'unpaired',
      couple_members: [
        { user_id: 'u1', left_at: new Date().toISOString() },
        { user_id: 'u2', left_at: new Date().toISOString() },
      ],
    };
    const notifications = jest.requireMock<{ getPermissionsAsync: jest.Mock }>(
      'expo-notifications',
    );

    beforeEach(() => {
      mockUser = { userId: 'u1' };
      mockCouple = PAIRED;
      mockPrefs = PREFS;
    });

    afterEach(() => {
      notifications.getPermissionsAsync.mockResolvedValue({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
        expires: 'never',
      });
    });

    it('Delete account is 3 taps from Today: Us tab, Delete account, Delete forever', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      await fireEvent.press(await screen.findByTestId('tab-us')); // 1
      await fireEvent.press(await screen.findByTestId('40-delete')); // 2
      await waitFor(() => expect(r.getPathname()).toBe('/us/delete'));
      await fireEvent.changeText(await screen.findByTestId('43-input'), 'DELETE');
      await fireEvent.press(screen.getByTestId('43-confirm')); // 3
      await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
      expect(mockWipe).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    });

    it('43: a wrong word deletes nothing and says what to type', async () => {
      await renderRouter(APP_DIR, { initialUrl: '/us/delete' });
      await fireEvent.changeText(await screen.findByTestId('43-input'), 'delete');
      await fireEvent.press(screen.getByTestId('43-confirm'));
      expect(await screen.findByText('Type DELETE in capital letters to confirm.')).toBeTruthy();
      expect(mockDeleteAccount).not.toHaveBeenCalled();
      expect(mockWipe).not.toHaveBeenCalled();
    });

    it('43: a function error is shown inline and keeps the person signed in', async () => {
      mockDeleteAccount.mockRejectedValue(new AppError('NETWORK', 'You seem to be offline.'));
      const r = await renderRouter(APP_DIR, { initialUrl: '/us/delete' });
      await fireEvent.changeText(await screen.findByTestId('43-input'), ' DELETE ');
      await fireEvent.press(screen.getByTestId('43-confirm'));
      expect(await screen.findByTestId('43-error')).toBeTruthy();
      expect(screen.getByText('You seem to be offline.')).toBeTruthy();
      expect(mockWipe).not.toHaveBeenCalled();
      expect(r.getPathname()).toBe('/us/delete');
    });

    it('43: "Keep my account" goes back to 40', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
      await fireEvent.press(await screen.findByTestId('40-delete'));
      await fireEvent.press(await screen.findByTestId('43-keep'));
      await waitFor(() => expect(r.getPathname()).toBe('/us'));
      expect(mockDeleteAccount).not.toHaveBeenCalled();
    });

    it('40 shows the pair, ritual time and the free plan; Premium opens the paywall', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
      expect(await screen.findByText('Alex & Sam')).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByTestId('40-ritual').props.accessibilityLabel).toBe('Ritual time, 21:00'),
      );
      await waitFor(() =>
        expect(screen.getByTestId('40-premium').props.accessibilityLabel).toBe(
          'Premium, See plans',
        ),
      );
      await fireEvent.press(screen.getByTestId('40-premium'));
      await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
      expect(r.getSearchParams()).toMatchObject({ from: 'settings' });
    });

    it('40: ritual time sheet saves the picked time', async () => {
      await renderRouter(APP_DIR, { initialUrl: '/us' });
      await fireEvent.press(await screen.findByTestId('40-ritual'));
      await fireEvent.press(await screen.findByTestId('40-ritual-morning'));
      await waitFor(() =>
        expect(mockSavePrefs).toHaveBeenCalledWith('u1', { ritual_time: '08:00' }),
      );
    });

    it('40: a custom time chosen on N shows as the selected time (MOB-72)', async () => {
      // N saves its custom time as `ritual_time` at setup (see "after sign-in: ritual time…");
      // Postgres returns it as a `time`.
      mockPrefs = { ...PREFS, ritual_time: '19:45:00' };
      await renderRouter(APP_DIR, { initialUrl: '/us' });
      await waitFor(() =>
        expect(screen.getByTestId('40-ritual').props.accessibilityLabel).toBe('Ritual time, 19:45'),
      );
      await fireEvent.press(screen.getByTestId('40-ritual'));
      const custom = await screen.findByTestId('40-ritual-custom');
      expect(custom.props.accessibilityLabel).toBe('Your time. 19:45');
      expect(custom).toBeChecked();
      for (const id of ['morning', 'lunch', 'evening']) {
        expect(screen.getByTestId(`40-ritual-${id}`)).not.toBeChecked();
      }
      // Tapping it opens the picker at that time.
      await fireEvent.press(custom);
      expect(await screen.findByTestId('40-ritual-picker')).toBeTruthy();
      expect(screen.getByTestId('40-ritual-picker-hour-value')).toHaveTextContent('19');
      expect(screen.getByTestId('40-ritual-picker-minute-value')).toHaveTextContent('45');
    });

    it('40: "Pick another time" saves any time as ritual_time (MOB-72)', async () => {
      mockSavePrefs.mockImplementation((_uid, patch) => {
        mockPrefs = { ...PREFS, ...patch };
        return Promise.resolve();
      });
      await renderRouter(APP_DIR, { initialUrl: '/us' });
      await waitFor(() =>
        expect(screen.getByTestId('40-ritual').props.accessibilityLabel).toBe('Ritual time, 21:00'),
      );
      await fireEvent.press(screen.getByTestId('40-ritual'));
      // A preset time shows no custom row.
      expect(await screen.findByTestId('40-ritual-evening')).toBeChecked();
      expect(screen.queryByTestId('40-ritual-custom')).toBeNull();
      await fireEvent.press(screen.getByTestId('40-ritual-other'));
      expect(await screen.findByTestId('40-ritual-picker')).toBeTruthy();
      expect(screen.getByText('Pick a time')).toBeTruthy();
      // From 21:00: two hours earlier, 15 minutes later.
      await fireEvent.press(screen.getByTestId('40-ritual-picker-hour-down'));
      await fireEvent.press(screen.getByTestId('40-ritual-picker-hour-down'));
      for (let i = 0; i < 3; i += 1) {
        await fireEvent.press(screen.getByTestId('40-ritual-picker-minute-up'));
      }
      await fireEvent.press(screen.getByTestId('40-ritual-picker-use'));
      await waitFor(() =>
        expect(mockSavePrefs).toHaveBeenCalledWith('u1', { ritual_time: '19:15' }),
      );
      await waitFor(() => expect(screen.queryByTestId('40-ritual-sheet')).toBeNull());
      await waitFor(() =>
        expect(screen.getByTestId('40-ritual').props.accessibilityLabel).toBe('Ritual time, 19:15'),
      );
      // Reopened, the new time is the selected custom row.
      await fireEvent.press(screen.getByTestId('40-ritual'));
      expect(await screen.findByTestId('40-ritual-custom')).toBeChecked();
    });

    it('40: closing the picker goes back to the presets and saves nothing (MOB-72)', async () => {
      await renderRouter(APP_DIR, { initialUrl: '/us' });
      await fireEvent.press(await screen.findByTestId('40-ritual'));
      await fireEvent.press(await screen.findByTestId('40-ritual-other'));
      expect(await screen.findByTestId('40-ritual-picker')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Close'));
      expect(await screen.findByTestId('40-ritual-morning')).toBeTruthy();
      expect(screen.queryByTestId('40-ritual-picker')).toBeNull();
      expect(mockSavePrefs).not.toHaveBeenCalled();
    });

    it('40: sign out asks first, then ends the session', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
      await fireEvent.press(await screen.findByTestId('40-sign-out'));
      await fireEvent.press(await screen.findByTestId('40-sign-out-cancel'));
      expect(mockUser).not.toBeNull();
      await fireEvent.press(screen.getByTestId('40-sign-out'));
      await fireEvent.press(await screen.findByTestId('40-sign-out-confirm'));
      await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    });

    it('41: a switch saves at once', async () => {
      mockSavePrefs.mockImplementation((_uid, patch) => {
        mockPrefs = { ...PREFS, ...patch };
        return Promise.resolve();
      });
      const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
      await fireEvent.press(await screen.findByTestId('40-notifications'));
      await waitFor(() => expect(r.getPathname()).toBe('/us/notifications'));
      const replies = await screen.findByTestId('41-replies');
      expect(replies.props.accessibilityState).toMatchObject({ checked: true });
      await fireEvent.press(replies);
      await waitFor(() => expect(mockSavePrefs).toHaveBeenCalledWith('u1', { replies: false }));
      await waitFor(() =>
        expect(screen.getByTestId('41-replies').props.accessibilityState).toMatchObject({
          checked: false,
        }),
      );
      expect(screen.getByTestId('41-nudges').props.accessibilityLabel).toBe(
        'Nudges from Sam. Max one a day',
      );
    });

    it('41: a failed save puts the switch back and says so', async () => {
      mockSavePrefs.mockRejectedValue(new AppError('UNKNOWN', 'x'));
      await renderRouter(APP_DIR, { initialUrl: '/us/notifications' });
      await fireEvent.press(await screen.findByTestId('41-tips'));
      expect(await screen.findByTestId('41-save-error')).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByTestId('41-tips').props.accessibilityState).toMatchObject({
          checked: false,
        }),
      );
    });

    it('41: quiet hours pick a window', async () => {
      await renderRouter(APP_DIR, { initialUrl: '/us/notifications' });
      await fireEvent.press(await screen.findByTestId('41-quiet'));
      await fireEvent.press(await screen.findByTestId('41-quiet-22:00-07:00'));
      await waitFor(() =>
        expect(mockSavePrefs).toHaveBeenCalledWith('u1', {
          quiet_start: '22:00',
          quiet_end: '07:00',
        }),
      );
    });

    it('41: OS permission denied links to the system settings', async () => {
      notifications.getPermissionsAsync.mockResolvedValue({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        expires: 'never',
      });
      const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
      await renderRouter(APP_DIR, { initialUrl: '/us/notifications' });
      await fireEvent.press(await screen.findByTestId('41-open-settings'));
      expect(open).toHaveBeenCalled();
      open.mockRestore();
    });

    it('42: cancelling unpair changes nothing', async () => {
      await renderRouter(APP_DIR, { initialUrl: '/us/couple' });
      await fireEvent.press(await screen.findByTestId('42-unpair'));
      expect(await screen.findByText('Unpair from Sam?')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('42-unpair-cancel'));
      expect(mockUnpair).not.toHaveBeenCalled();
      expect(useEndedSeen.getState().seen).toEqual([]);
    });

    it('42: confirming unpair ends the bond and never shows me 58', async () => {
      mockUnpair.mockImplementation(() => {
        mockCouple = null;
        mockEnded = { ...ENDED, id: 'couple-1' };
        return Promise.resolve();
      });
      const r = await renderRouter(APP_DIR, { initialUrl: '/us/couple' });
      await fireEvent.press(await screen.findByTestId('42-unpair'));
      await fireEvent.press(await screen.findByTestId('42-unpair-confirm'));
      await waitFor(() => expect(mockUnpair).toHaveBeenCalledTimes(1));
      // `/` starts a fresh space (09 first on a phone never asked), not 58.
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
      expect(useEndedSeen.getState().seen).toContain('couple-1');
      expect(screen.queryByTestId('58-screen')).toBeNull();
    });

    it('42: a failed unpair stays on 42 with the message', async () => {
      mockUnpair.mockRejectedValue(new AppError('NETWORK', 'You seem to be offline.'));
      const r = await renderRouter(APP_DIR, { initialUrl: '/us/couple' });
      await fireEvent.press(await screen.findByTestId('42-unpair'));
      await fireEvent.press(await screen.findByTestId('42-unpair-confirm'));
      expect(await screen.findByTestId('42-unpair-error')).toBeTruthy();
      expect(r.getPathname()).toBe('/us/couple');
      expect(useEndedSeen.getState().seen).toEqual([]);
    });

    it('42: a solo couple has no unpair, only the code to share', async () => {
      mockCouple = SOLO;
      await renderRouter(APP_DIR, { initialUrl: '/us/couple' });
      expect(await screen.findByTestId('42-solo')).toBeTruthy();
      expect(screen.queryByTestId('42-unpair')).toBeNull();
    });

    it('58: my partner left, so `/` tells me once; "Not now" moves on', async () => {
      mockCouple = null;
      mockEnded = ENDED;
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/partner-left'));
      expect(await screen.findByText('Sam has unpaired')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('58-not-now'));
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
      expect(useEndedSeen.getState().seen).toEqual(['couple-old']);
    });

    it('58 is skipped when I ended the couple myself on another phone (BE-38)', async () => {
      mockCouple = null;
      mockEnded = { ...ENDED, ended_by: 'u1' };
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
      expect(screen.queryByTestId('58-screen')).toBeNull();
    });

    it('58 after my partner deleted their account says "Your partner" (D09)', async () => {
      mockCouple = null;
      mockEnded = {
        ...ENDED,
        ended_by: null,
        ended_reason: 'deleted',
        couple_members: [ENDED.couple_members[0]],
      };
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/partner-left'));
      expect(await screen.findByText('Your partner has unpaired')).toBeTruthy();
      expect(mockProfileName).not.toHaveBeenCalled();
    });

    it('58 falls back to "Your partner" when the former profile is missing', async () => {
      mockCouple = null;
      mockEnded = ENDED;
      mockProfileName.mockResolvedValue(null);
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/partner-left'));
      expect(await screen.findByText('Your partner has unpaired')).toBeTruthy();
      expect(mockProfileName).toHaveBeenCalledWith('u2');
    });

    it('58 is not shown again for a couple already seen, nor for a solo archive', async () => {
      mockCouple = null;
      mockEnded = ENDED;
      useEndedSeen.setState({ seen: ['couple-old'] });
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/reminders'));
      expect(screen.queryByTestId('58-screen')).toBeNull();
    });

    it('a partner who unpairs while I am on Today sends me to 58', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByTestId('18-screen')).toBeTruthy();
      mockCouple = null;
      mockEnded = ENDED;
      // Both memberships get `left_at` (BE-09): the realtime change refetches the couple.
      await act(async () => {
        mockRealtime.emit('couple_members', {
          new: { couple_id: 'couple-1', user_id: 'u2', left_at: new Date().toISOString() },
        });
      });
      await waitFor(() => expect(r.getPathname()).toBe('/partner-left'));
    });
  });

  describe('History (MOB-16)', () => {
    const revealed = jest.mocked(getRevealedQuestion);
    const today = () => localDateKey(new Date(), null);
    const daysAgo = (n: number) =>
      new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const row = (id: string, assignedFor: string, extra: object = {}) => ({
      id,
      source: 'daily',
      assignedFor,
      createdAt: `${assignedFor}T00:05:00Z`,
      answerCount: 2,
      question: `Question ${id}`,
      hearts: 2,
      replies: 6,
      ...extra,
    });
    const DETAIL = {
      id: 'cq-28',
      source: 'daily',
      assignedFor: '2026-10-28',
      createdAt: '2026-10-28T00:05:00Z',
      answerCount: 2,
      question: 'When did you feel most proud of me?',
      answeredBy: ['u1', 'u2'],
      replies: 6,
    };

    beforeEach(() => {
      cacheStorage.removeItem('query-cache');
      revealed.mockReset();
    });

    it('29: heatmap, "days together", rows with counts; a past row opens 30, today opens /question', async () => {
      mockUser = { userId: 'u1' };
      mockFirstDay = daysAgo(2);
      mockHistoryDays = [
        { assignedFor: daysAgo(2), answerCount: 2 },
        { assignedFor: daysAgo(1), answerCount: 1 },
        { assignedFor: today(), answerCount: 2 },
      ];
      mockHistoryRows = [row('cq-today', today()), row('cq-old', daysAgo(1), { answerCount: 1 })];
      mockUnreadCounts = { 'cq-today': 2 };
      const r = await renderRouter(APP_DIR, { initialUrl: '/history' });
      expect(await screen.findByTestId('29-heatmap')).toBeTruthy();
      expect(screen.getByText('Question cq-old')).toBeTruthy();
      expect(await screen.findByTestId('29-row-cq-today-unread')).toBeTruthy();
      expect(screen.queryByTestId('29-row-cq-old-unread')).toBeNull();
      // No answer text is ever requested on 29.
      expect(revealed).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('29-row-cq-old'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-old'));
    });

    it('29: the title is capped like other titles and the month controls wrap under it (#107)', async () => {
      mockUser = { userId: 'u1' };
      mockFirstDay = daysAgo(40);
      mockHistoryRows = [row('cq-today', today()), row('cq-old', daysAgo(1))];
      await renderRouter(APP_DIR, { initialUrl: '/history' });
      const title = await screen.findByTestId('29-title');
      expect(title.props.maxFontSizeMultiplier).toBe(TITLE_MAX_FONT_SCALE);
      expect(screen.getByRole('header', { name: 'History' })).toBeTruthy();
      expect(StyleSheet.flatten(screen.getByTestId('29-header').props.style)).toMatchObject({
        flexWrap: 'wrap',
      });
    });

    it("29: today's row opens the question link (answer, reveal or thread as on Today)", async () => {
      mockUser = { userId: 'u1' };
      mockFirstDay = daysAgo(3);
      mockHistoryRows = [row('cq-today', today()), row('cq-old', daysAgo(3))];
      const r = await renderRouter(APP_DIR, { initialUrl: '/history' });
      await fireEvent.press(await screen.findByTestId('29-row-cq-today'));
      await waitFor(() => expect(r.getPathname()).not.toBe('/history'));
      expect(r.getPathname()).not.toBe('/history/cq-today');
    });

    it('53: nothing answered before today shows the empty state; the CTA opens Today', async () => {
      mockUser = { userId: 'u1' };
      mockFirstDay = today();
      mockHistoryRows = [row('cq-today', today(), { answerCount: 1 })];
      const r = await renderRouter(APP_DIR, { initialUrl: '/history' });
      expect(await screen.findByTestId('53-screen')).toBeTruthy();
      expect(screen.getByText('Your story starts today')).toBeTruthy();
      expect(screen.queryByTestId('29-heatmap')).toBeNull();
      await fireEvent.press(screen.getByTestId('53-answer'));
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
    });

    it('29: a load error shows a retry', async () => {
      mockUser = { userId: 'u1' };
      mockGetHistoryPage.mockRejectedValueOnce(new AppError('NOT_PAIRED', 'Not paired.'));
      await renderRouter(APP_DIR, { initialUrl: '/history' });
      expect(await screen.findByTestId('29-error')).toBeTruthy();
      await fireEvent.press(screen.getByText('Try again'));
      expect(await screen.findByTestId('53-screen')).toBeTruthy();
    });

    it('29: earlier months are a tap away once there is history there', async () => {
      mockUser = { userId: 'u1' };
      mockFirstDay = '2000-01-15';
      mockHistoryRows = [row('cq-old', daysAgo(40))];
      await renderRouter(APP_DIR, { initialUrl: '/history' });
      const chip = await screen.findByTestId('29-month');
      const before = within(chip).getByText(/\d{4}/).props.children as string;
      expect(screen.queryByTestId('29-month-next')).toBeNull();
      await fireEvent.press(screen.getByTestId('29-month-prev'));
      await waitFor(() =>
        expect(within(screen.getByTestId('29-month')).getByText(/\d{4}/).props.children).not.toBe(
          before,
        ),
      );
      expect(screen.getByTestId('29-month-next')).toBeTruthy();
    });

    it('30: both answered: partner then mine, the thread preview, and Open thread', async () => {
      mockUser = { userId: 'u1' };
      mockHistoryDetail = DETAIL;
      mockLastMessage = { userId: 'u2', body: 'Still thinking about that speech.' };
      revealed.mockResolvedValue({
        id: 'cq-28',
        answerCount: 2,
        question: DETAIL.question,
        answers: [
          {
            id: 'a1',
            userId: 'u1',
            body: 'The email to your old boss.',
            createdAt: '',
            // D45: Sam's emoji on my answer (stored kind; a bare heart reads as ❤️).
            reactions: [{ id: 'r1', userId: 'u2', kind: '\u2764' }],
          },
          {
            id: 'a2',
            userId: 'u2',
            body: "At your sister's wedding.",
            createdAt: '',
            reactions: [{ id: 'r2', userId: 'u1', kind: '🥹' }],
          },
        ],
      });
      const r = await renderRouter(APP_DIR, { initialUrl: '/history/cq-28' });
      expect(await screen.findByTestId('30-partner')).toBeTruthy();
      expect(screen.getByText("At your sister's wedding.")).toBeTruthy();
      expect(screen.getByText('The email to your old boss.')).toBeTruthy();
      // D45 read-only reactions under each answer, named for screen readers; nothing to tap.
      expect(screen.getByTestId('30-mine-reactions')).toHaveTextContent(/❤️\s*Sam/);
      expect(screen.getByLabelText('Sam reacted with red heart')).toBeTruthy();
      expect(screen.getByTestId('30-partner-reactions')).toHaveTextContent(/🥹\s*You/);
      expect(screen.getByLabelText('You reacted with face holding back tears')).toBeTruthy();
      expect(screen.queryByLabelText(/^React with/)).toBeNull();
      expect(screen.getByText('6 replies')).toBeTruthy();
      expect(await screen.findByText('Sam: Still thinking about that speech.')).toBeTruthy();
      expect(screen.getByTestId('30-chip')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('30-open-thread'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-28/thread'));
      expect(await screen.findByTestId('22-screen')).toBeTruthy();
      expect(await screen.findByText(DETAIL.question)).toBeTruthy();
    });

    it('30: the reveal rule: without my answer no text is requested and the partner stays locked', async () => {
      mockUser = { userId: 'u1' };
      mockHistoryDetail = { ...DETAIL, answerCount: 1, answeredBy: [], replies: 0 };
      await renderRouter(APP_DIR, { initialUrl: '/history/cq-28' });
      expect(await screen.findByTestId('30-partner-locked')).toBeTruthy();
      expect(screen.getByTestId('30-answer-first')).toBeTruthy();
      expect(screen.queryByTestId('30-open-thread')).toBeNull();
      expect(revealed).not.toHaveBeenCalled();
      expect(mockGetLastMessage).not.toHaveBeenCalled();
    });

    it('30: only I answered: my answer and a note, no thread', async () => {
      mockUser = { userId: 'u1' };
      mockHistoryDetail = { ...DETAIL, answerCount: 1, answeredBy: ['u1'], replies: 0 };
      revealed.mockResolvedValue({
        id: 'cq-28',
        answerCount: 1,
        question: DETAIL.question,
        answers: [{ id: 'a1', userId: 'u1', body: 'Mine only.', createdAt: '', reactions: [] }],
      });
      await renderRouter(APP_DIR, { initialUrl: '/history/cq-28' });
      expect(await screen.findByTestId('30-mine')).toBeTruthy();
      expect(screen.getByTestId('30-partner-missed')).toBeTruthy();
      expect(screen.queryByTestId('30-thread-card')).toBeNull();
      expect(mockGetLastMessage).not.toHaveBeenCalled();
    });

    it('30: a question that is not in my history says so', async () => {
      mockUser = { userId: 'u1' };
      await renderRouter(APP_DIR, { initialUrl: '/history/nope' });
      expect(await screen.findByTestId('30-not-found')).toBeTruthy();
    });
  });

  describe('ended couple History (MOB-50, D08)', () => {
    const revealed = jest.mocked(getRevealedQuestion);
    const DAY = 86_400_000;
    const endedDaysAgo = (n: number) => {
      const at = new Date(Date.now() - n * DAY).toISOString();
      return {
        id: 'couple-old',
        ended_at: at,
        paired_at: '2026-10-01T10:00:00Z',
        ended_by: 'u2',
        ended_reason: 'unpaired',
        couple_members: [
          { user_id: 'u1', left_at: at },
          { user_id: 'u2', left_at: at },
        ],
      };
    };
    const row = (id: string, answeredBy: string[], replies = 0) => ({
      id,
      source: 'daily',
      assignedFor: '2026-10-20',
      createdAt: '2026-10-20T00:05:00Z',
      question: `Question ${id}`,
      answeredBy,
      replies,
    });
    const answer = (userId: string, body: string) => ({
      id: `a-${userId}`,
      userId,
      body,
      createdAt: '',
      reactions: [],
    });

    beforeEach(() => {
      cacheStorage.removeItem('query-cache');
      revealed.mockReset();
      mockUser = { userId: 'u1' };
      mockEndedRows = [
        row('cq-both', ['u1', 'u2'], 2),
        row('cq-mine', ['u1']),
        row('cq-theirs', ['u2']),
      ];
    });

    it('58 -> History of the ended couple -> a revealed question, read-only', async () => {
      mockCouple = null;
      mockEnded = endedDaysAgo(2);
      revealed.mockResolvedValue({
        id: 'cq-both',
        answerCount: 2,
        question: 'Question cq-both',
        answers: [answer('u1', 'FIXTURE-MINE'), answer('u2', 'FIXTURE-THEIRS')],
      });
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/partner-left'));
      await fireEvent.press(await screen.findByTestId('58-history'));
      await waitFor(() => expect(r.getPathname()).toBe('/ended'));
      expect(await screen.findByText('Your History with Sam')).toBeTruthy();
      expect(mockGetEndedPage).toHaveBeenCalledWith('couple-old', 0);
      // Only questions I answered; no answer text on the list.
      expect(await screen.findByTestId('ended-row-cq-both')).toBeTruthy();
      expect(screen.getByTestId('ended-row-cq-mine')).toBeTruthy();
      expect(screen.queryByTestId('ended-row-cq-theirs')).toBeNull();
      expect(revealed).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('ended-row-cq-both'));
      await waitFor(() => expect(r.getPathname()).toBe('/ended/cq-both'));
      expect(await screen.findByText('FIXTURE-THEIRS')).toBeTruthy();
      expect(screen.getByText('FIXTURE-MINE')).toBeTruthy();
      expect(screen.getByTestId('ended-q-thread')).toBeTruthy();
      expect(screen.getByTestId('ended-q-read-only')).toBeTruthy();
      // Read-only: no composer, no thread link, no answer button.
      expect(screen.queryByTestId('30-open-thread')).toBeNull();
      expect(screen.queryByTestId('22-screen')).toBeNull();
      // 58 was not marked seen: back returns to it.
      expect(useEndedSeen.getState().seen).toEqual([]);
    });

    it('29 shows the door to the ended couple next to my new space', async () => {
      mockEnded = endedDaysAgo(29);
      const r = await renderRouter(APP_DIR, { initialUrl: '/history' });
      expect(await screen.findByText('Your History with Sam')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('29-ended'));
      await waitFor(() => expect(r.getPathname()).toBe('/ended'));
      expect(await screen.findByTestId('ended-row-cq-both')).toBeTruthy();
    });

    it('MOB-70: the list and the answers show the real last day (ended_at + 30 days)', async () => {
      // Fixture ended_at: 5 days ago at noon UTC -> readable until 25 days from now.
      const endedAt = new Date(Date.now() - 5 * DAY);
      endedAt.setUTCHours(12, 0, 0, 0);
      mockEnded = { ...endedDaysAgo(5), ended_at: endedAt.toISOString() };
      revealed.mockResolvedValue({
        id: 'cq-both',
        answerCount: 2,
        question: 'Question cq-both',
        answers: [answer('u1', 'FIXTURE-MINE'), answer('u2', 'FIXTURE-THEIRS')],
      });
      // jest's phone locale is en-US.
      const date = new Date(endedAt.getTime() + 30 * DAY).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      const text = `You can read these until ${date}. After that they're deleted.`;
      const r = await renderRouter(APP_DIR, { initialUrl: '/ended' });
      const note = await screen.findByTestId('ended-note');
      expect(note.props.accessibilityLabel).toBe(text);
      expect(screen.getByTestId('ended-note-text')).toHaveTextContent(text);
      await fireEvent.press(await screen.findByTestId('ended-row-cq-both'));
      await waitFor(() => expect(r.getPathname()).toBe('/ended/cq-both'));
      expect(await screen.findByText('FIXTURE-MINE')).toBeTruthy();
      expect(screen.getByTestId('ended-q-note')).toHaveTextContent(text);
      expect(screen.getByTestId('ended-q-note').props.accessibilityLabel).toBe(text);
    });

    it('after 30 days the ended History is not shown anywhere', async () => {
      mockEnded = endedDaysAgo(31);
      await renderRouter(APP_DIR, { initialUrl: '/history' });
      expect(await screen.findByTestId('29-screen')).toBeTruthy();
      await waitFor(() => expect(mockGetHistoryPage).toHaveBeenCalled());
      expect(screen.queryByTestId('29-ended')).toBeNull();
    });

    it.each([
      ['/ended', 'ended-closed'],
      ['/ended/cq-both', 'ended-q-closed'],
    ])('after 30 days %s says it is gone and reads nothing', async (url, testID) => {
      mockEnded = endedDaysAgo(31);
      await renderRouter(APP_DIR, { initialUrl: url });
      expect(await screen.findByTestId(testID)).toBeTruthy();
      // MOB-52: the closed state has a screen-reader heading.
      const title = screen.getByTestId(`${testID}-title`);
      expect(title.props.accessibilityRole).toBe('header');
      expect(title).toHaveTextContent('This History has closed');
      expect(mockGetEndedPage).not.toHaveBeenCalled();
      expect(mockGetEndedQuestion).not.toHaveBeenCalled();
      expect(revealed).not.toHaveBeenCalled();
    });

    it('58 offers no History link once the 30 days are over', async () => {
      mockCouple = null;
      mockEnded = endedDaysAgo(31);
      const r = await renderRouter(APP_DIR, { initialUrl: '/' });
      await waitFor(() => expect(r.getPathname()).toBe('/partner-left'));
      expect(await screen.findByTestId('58-invite')).toBeTruthy();
      expect(screen.queryByTestId('58-history')).toBeNull();
    });

    it('the reveal rule: a question only my partner answered shows no text and asks for none', async () => {
      mockEnded = endedDaysAgo(1);
      await renderRouter(APP_DIR, { initialUrl: '/ended/cq-theirs' });
      expect(await screen.findByTestId('ended-q-unanswered')).toBeTruthy();
      expect(screen.queryByTestId('ended-q-partner')).toBeNull();
      expect(revealed).not.toHaveBeenCalled();
    });

    it("only I answered: my answer, never my partner's, and no thread", async () => {
      mockEnded = endedDaysAgo(1);
      // Even if a row came back, one-sided means no partner card.
      revealed.mockResolvedValue({
        id: 'cq-mine',
        answerCount: 1,
        question: 'Question cq-mine',
        answers: [answer('u1', 'FIXTURE-MINE'), answer('u2', 'FIXTURE-THEIRS')],
      });
      await renderRouter(APP_DIR, { initialUrl: '/ended/cq-mine' });
      expect(await screen.findByText('FIXTURE-MINE')).toBeTruthy();
      expect(screen.getByTestId('ended-q-only-mine')).toBeTruthy();
      expect(screen.queryByText('FIXTURE-THEIRS')).toBeNull();
      expect(screen.queryByTestId('ended-q-thread')).toBeNull();
    });

    it('after an account deletion the History says "your partner", no name is read (D09)', async () => {
      mockCouple = null;
      mockEnded = {
        ...endedDaysAgo(1),
        ended_by: null,
        ended_reason: 'deleted',
        couple_members: [{ user_id: 'u1', left_at: new Date().toISOString() }],
      };
      await renderRouter(APP_DIR, { initialUrl: '/ended' });
      expect(await screen.findByText('Your History with your partner')).toBeTruthy();
      expect(mockProfileName).not.toHaveBeenCalled();
    });
  });

  describe('History is Premium beyond yesterday (MOB-71, D55)', () => {
    const revealed = jest.mocked(getRevealedQuestion);
    const today = () => localDateKey(new Date(), null);
    const daysAgo = (n: number) =>
      new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    // As `getHistoryPage` maps `history_days`: the server decides `locked`, the app only shows it.
    const row = (id: string, ago: number, locked: boolean) => ({
      id,
      source: 'daily',
      assignedFor: daysAgo(ago),
      createdAt: `${daysAgo(ago)}T00:05:00Z`,
      answerCount: 2,
      question: `Question ${id}`,
      hearts: locked ? 0 : 2,
      replies: 4,
      locked,
    });
    const detail = (locked: boolean, answeredBy = ['u1', 'partner']) => ({
      id: 'cq-old',
      source: 'daily',
      assignedFor: daysAgo(2),
      createdAt: `${daysAgo(2)}T00:05:00Z`,
      answerCount: answeredBy.length,
      question: 'Question cq-old',
      answeredBy,
      replies: 4,
      locked,
    });
    const TEXT = {
      id: 'cq-old',
      answerCount: 2,
      question: 'Question cq-old',
      answers: [
        { id: 'a1', userId: 'u1', body: 'FIXTURE-MINE-OLD', createdAt: '', reactions: [] },
        { id: 'a2', userId: 'u2', body: 'FIXTURE-THEIRS-OLD', createdAt: '', reactions: [] },
      ],
    };
    const PREMIUM = [{ user_id: 'u1', is_active: true, expires_at: null }];

    beforeEach(() => {
      cacheStorage.removeItem('query-cache');
      revealed.mockReset();
      mockUser = { userId: 'u1' };
      mockFirstDay = daysAgo(3);
    });

    it('free: day -1 opens; day -2 shows the lock and "Premium" and opens the paywall from=history', async () => {
      mockHistoryRows = [row('cq-yday', 1, false), row('cq-old', 2, true)];
      const r = await renderRouter(APP_DIR, { initialUrl: '/history' });
      const locked = await screen.findByTestId('29-row-cq-old');
      // The day stays listed with its date and question; the counts make way for the lock.
      expect(screen.getByText('Question cq-old')).toBeTruthy();
      expect(screen.getByTestId('29-row-cq-old-locked')).toHaveTextContent('Premium');
      expect(screen.queryByTestId('29-row-cq-yday-locked')).toBeNull();
      expect(locked.props.accessibilityLabel).toMatch(
        /^.+\. Question cq-old Answers locked\. Premium\.$/,
      );
      expect(screen.getByTestId('29-row-cq-yday').props.accessibilityLabel).toMatch(
        /2 reactions, 4 replies\.$/,
      );
      await fireEvent.press(locked);
      await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
      expect(r.getSearchParams()).toMatchObject({ from: 'history' });
      expect(await screen.findByTestId('16-screen')).toBeTruthy();
      expect(revealed).not.toHaveBeenCalled();
    });

    it('free: yesterday opens 30 with the answers', async () => {
      mockHistoryRows = [row('cq-yday', 1, false), row('cq-old', 2, true)];
      const r = await renderRouter(APP_DIR, { initialUrl: '/history' });
      await fireEvent.press(await screen.findByTestId('29-row-cq-yday'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-yday'));
    });

    it('Premium: every day opens', async () => {
      mockEntitlements = PREMIUM;
      mockHistoryRows = [
        row('cq-yday', 1, false),
        row('cq-old', 2, false),
        row('cq-older', 9, false),
      ];
      const r = await renderRouter(APP_DIR, { initialUrl: '/history' });
      await fireEvent.press(await screen.findByTestId('29-row-cq-older'));
      await waitFor(() => expect(r.getPathname()).toBe('/history/cq-older'));
      expect(screen.queryByTestId('29-row-cq-old-locked')).toBeNull();
    });

    it('30 of a locked day: question, who answered (locked, "Premium"), no text, no thread; unlock opens 16', async () => {
      mockHistoryDetail = detail(true);
      const r = await renderRouter(APP_DIR, { initialUrl: '/history/cq-old' });
      expect(await screen.findByTestId('30-locked')).toBeTruthy();
      expect(screen.getByTestId('30-question')).toHaveTextContent('Question cq-old');
      expect(screen.getByTestId('30-chip')).toBeTruthy();
      const partner = screen.getByTestId('30-partner-premium');
      expect(partner).toHaveTextContent(/Kept for you with Premium/);
      expect(partner.props.accessibilityLabel).toBe("Sam's answer, locked. Premium.");
      expect(screen.getByTestId('30-mine-premium').props.accessibilityLabel).toBe(
        'Your answer, locked. Premium.',
      );
      expect(screen.queryByTestId('30-open-thread')).toBeNull();
      expect(screen.queryByTestId('30-thread-card')).toBeNull();
      expect(revealed).not.toHaveBeenCalled();
      expect(mockGetLastMessage).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('30-unlock-cta'));
      await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
      expect(r.getSearchParams()).toMatchObject({ from: 'history' });
    });

    it('the thread of a locked day is locked too: no messages, no composer', async () => {
      mockHistoryDetail = detail(true);
      const r = await renderRouter(APP_DIR, { initialUrl: '/history/cq-old/thread' });
      expect(await screen.findByTestId('22-locked')).toBeTruthy();
      expect(screen.getByTestId('22-unlock-body')).toHaveTextContent(
        'The replies of older days are kept for you with Premium.',
      );
      expect(screen.queryByTestId('22-messages')).toBeNull();
      expect(screen.queryByTestId('22-composer')).toBeNull();
      expect(screen.queryByTestId('22-answers')).toBeNull();
      await fireEvent.press(screen.getByTestId('22-unlock-cta'));
      await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
      expect(r.getSearchParams()).toMatchObject({ from: 'history' });
    });

    it('a lapse relocks in-session: the text shown with Premium is gone', async () => {
      mockEntitlements = PREMIUM;
      mockHistoryDetail = detail(false, ['u1', 'u2']);
      revealed.mockResolvedValue(TEXT);
      await renderRouter(APP_DIR, { initialUrl: '/history/cq-old' });
      expect(await screen.findByText('FIXTURE-THEIRS-OLD', {}, { timeout: 4000 })).toBeTruthy();
      // Premium ends: the server now marks the day locked and returns no answers. The next
      // entitlement read (here: the app coming back to the foreground) sees the lapse.
      mockEntitlements = [];
      mockHistoryDetail = detail(true);
      revealed.mockClear();
      try {
        await act(async () => {
          jest.advanceTimersByTime(31_000);
          focusManager.setFocused(false);
          focusManager.setFocused(true);
        });
        expect(await screen.findByTestId('30-locked', {}, { timeout: 4000 })).toBeTruthy();
      } finally {
        await act(async () => focusManager.setFocused(undefined));
      }
      expect(screen.queryByText('FIXTURE-THEIRS-OLD')).toBeNull();
      expect(screen.queryByText('FIXTURE-MINE-OLD')).toBeNull();
    }, 20_000);

    it('Premium again: the same older day opens with its answers (nothing was deleted)', async () => {
      // A purchase refetches the entitlements and History in-session (history/__tests__/relock).
      mockEntitlements = PREMIUM;
      mockHistoryDetail = detail(false, ['u1', 'u2']);
      revealed.mockResolvedValue(TEXT);
      await renderRouter(APP_DIR, { initialUrl: '/history/cq-old' });
      expect(await screen.findByText('FIXTURE-THEIRS-OLD', {}, { timeout: 4000 })).toBeTruthy();
      expect(screen.getByText('FIXTURE-MINE-OLD')).toBeTruthy();
      expect(screen.queryByTestId('30-locked')).toBeNull();
    }, 20_000);

    describe('ended couple archive (D08 + D55)', () => {
      const DAY = 86_400_000;
      const ended = () => {
        const at = new Date(Date.now() - 5 * DAY).toISOString();
        return {
          id: 'couple-old',
          ended_at: at,
          paired_at: '2026-10-01T10:00:00Z',
          ended_by: 'u2',
          ended_reason: 'unpaired',
          couple_members: [
            { user_id: 'u1', left_at: at },
            { user_id: 'u2', left_at: at },
          ],
        };
      };
      const endedRow = (id: string, locked: boolean) => ({
        id,
        source: 'daily',
        assignedFor: daysAgo(6),
        createdAt: `${daysAgo(6)}T00:05:00Z`,
        question: `Question ${id}`,
        answeredBy: ['u1', 'partner'],
        replies: 2,
        locked,
      });

      it('without my own Premium older days are listed locked and open the paywall', async () => {
        mockEnded = ended();
        mockEndedRows = [endedRow('cq-open', false), endedRow('cq-shut', true)];
        const r = await renderRouter(APP_DIR, { initialUrl: '/ended' });
        const shut = await screen.findByTestId('ended-row-cq-shut', {}, { timeout: 4000 });
        expect(screen.getByTestId('ended-row-cq-shut-locked')).toHaveTextContent('Premium');
        expect(shut.props.accessibilityLabel).toMatch(
          /Question cq-shut Answers locked\. Premium\.$/,
        );
        await fireEvent.press(shut);
        await waitFor(() => expect(r.getPathname()).toBe('/paywall'));
        expect(r.getSearchParams()).toMatchObject({ from: 'history' });
      });

      it('a locked archived day by link: who answered, no text, the way to Premium', async () => {
        mockEnded = ended();
        mockEndedRows = [endedRow('cq-shut', true)];
        await renderRouter(APP_DIR, { initialUrl: '/ended/cq-shut' });
        expect(await screen.findByTestId('ended-q-locked', {}, { timeout: 4000 })).toBeTruthy();
        expect(screen.getByTestId('ended-q-partner-premium')).toBeTruthy();
        expect(screen.getByTestId('ended-q-mine-premium')).toBeTruthy();
        expect(screen.getByTestId('ended-q-unlock-cta')).toBeTruthy();
        expect(revealed).not.toHaveBeenCalled();
      });
    });
  });

  describe('A daily question is answered only on its day (MOB-73, D56)', () => {
    const PAIRED_D56 = {
      ...SOLO,
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
      paired_at: new Date().toISOString(),
    };
    const today = () => localDateKey(new Date(), null);
    const daysAgo = (n: number) =>
      new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const row = (
      id: string,
      ago: number,
      by: { me: boolean; partner: boolean },
      source = 'daily',
    ) => ({
      id,
      source,
      assignedFor: source === 'daily' ? daysAgo(ago) : null,
      createdAt: `${daysAgo(ago)}T00:05:00Z`,
      answerCount: (by.me ? 1 : 0) + (by.partner ? 1 : 0),
      myAnswered: by.me,
      question: `Question ${id}`,
      hearts: 0,
      replies: 0,
      locked: false,
    });
    const detail = (id: string, ago: number, answeredBy: string[]) => ({
      id,
      source: 'daily',
      assignedFor: daysAgo(ago),
      createdAt: `${daysAgo(ago)}T00:05:00Z`,
      answerCount: answeredBy.length,
      question: `Question ${id}`,
      answeredBy,
      replies: 0,
      locked: false,
    });
    const LATE = 'FIXTURE-LATE-ANSWER';

    beforeEach(() => {
      cacheStorage.removeItem('query-cache');
      mockUser = { userId: 'u1' };
      mockCouple = PAIRED_D56;
      mockFirstDay = daysAgo(5);
      mockSaveAnswer.mockReset();
      mockSaveAnswer.mockResolvedValue(undefined);
      useDrafts.getState().reset();
      clearOutbox();
    });

    it('29: a past day only one of us answered says who, without text; today and packs do not', async () => {
      mockHistoryRows = [
        row('cq-today', 0, { me: true, partner: false }),
        row('cq-theirs', 1, { me: false, partner: true }),
        row('cq-mine', 2, { me: true, partner: false }),
        row('cq-both', 3, { me: true, partner: true }),
        row('cq-pack', 3, { me: true, partner: false }, 'pack'),
      ];
      await renderRouter(APP_DIR, { initialUrl: '/history' });
      expect(await screen.findByTestId('29-row-cq-theirs-only')).toHaveTextContent(
        'Only Sam answered',
      );
      expect(screen.getByTestId('29-row-cq-mine-only')).toHaveTextContent('Only you answered');
      expect(screen.getByTestId('29-row-cq-theirs').props.accessibilityLabel).toMatch(
        /Only Sam answered\.$/,
      );
      expect(screen.queryByTestId('29-row-cq-today-only')).toBeNull();
      expect(screen.queryByTestId('29-row-cq-both-only')).toBeNull();
      expect(screen.queryByTestId('29-row-cq-pack-only')).toBeNull();
    });

    it.each([
      ['not answered', [] as string[]],
      ['my answer (no edits)', ['u1']],
      ['only Sam answered', ['u2']],
    ])(
      'a past day has no answer entry (%s): "This day has ended", the way to today, no paywall',
      async (_case, by) => {
        mockHistoryDetail = detail('cq-old', 2, by);
        const r = await renderRouter(APP_DIR, { initialUrl: '/history/cq-old/answer' });
        expect(await screen.findByTestId('19-day-ended')).toHaveTextContent(/This day has ended/);
        expect(screen.getByTestId('19-day-ended-question')).toHaveTextContent('Question cq-old');
        expect(screen.queryByTestId('19-field')).toBeNull();
        expect(screen.queryByTestId('19-submit')).toBeNull();
        expect(screen.queryByTestId('19-switch')).toBeNull();
        await fireEvent.press(screen.getByTestId('19-day-ended-today'));
        await waitFor(() => expect(r.getPathname()).toBe('/today'));
        expect(mockSaveAnswer).not.toHaveBeenCalled();
      },
    );

    it("today's daily question opened by id answers in the Today flow", async () => {
      mockHistoryDetail = detail('cq-1', 0, []);
      const r = await renderRouter(APP_DIR, { initialUrl: '/history/cq-1/answer' });
      await waitFor(() => expect(r.getPathname()).toBe('/today/answer'));
      expect(await screen.findByTestId('19-field')).toBeTruthy();
    });

    it('DAY_ENDED on lock-in: the message, the draft stays, the way to today, never the paywall', async () => {
      mockSaveAnswer.mockRejectedValue(new AppError('DAY_ENDED', 'server text'));
      const r = await renderRouter(APP_DIR, { initialUrl: '/today/answer' });
      await fireEvent.changeText(await screen.findByTestId('19-field'), LATE);
      await fireEvent.press(screen.getByTestId('19-submit'));
      expect(await screen.findByTestId('19-error')).toHaveTextContent(/^This day has ended\./);
      expect(screen.queryByText('server text')).toBeNull();
      expect(screen.queryByTestId('19-submit')).toBeNull();
      expect(useDrafts.getState().drafts['cq-1']).toBe(LATE);
      expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
      await fireEvent.press(screen.getByTestId('19-day-ended-today'));
      await waitFor(() => expect(r.getPathname()).toBe('/today'));
      expect(r.getPathname()).not.toBe('/paywall');
      expect(useDrafts.getState().drafts['cq-1']).toBe(LATE);
    });

    it('Today: a queued answer that arrived after its day says so; the text is mine to read; OK clears it', async () => {
      const outbox = useOutbox.getState();
      outbox.queueAnswer({
        coupleQuestionId: 'cq-old',
        userId: 'u1',
        body: LATE,
        clientWrittenAt: `${daysAgo(1)}T23:50:00Z`,
      });
      outbox.setAnswerStatus('cq-old', 'failed', 'DAY_ENDED');
      useDrafts.getState().setDraft('cq-old', LATE);
      const r = await renderRouter(APP_DIR, { initialUrl: '/today' });
      const card = await screen.findByTestId('today-day-ended');
      expect(card).toHaveTextContent(/This day has ended/);
      expect(screen.queryByText(LATE)).toBeNull();
      // Today's question is right there: the offer is Today itself, not a paywall.
      expect(await screen.findByText('What made you smile?')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('today-day-ended-show'));
      expect(screen.getByTestId('today-day-ended-text')).toHaveTextContent(LATE);
      await fireEvent.press(screen.getByTestId('today-day-ended-dismiss'));
      await waitFor(() => expect(screen.queryByTestId('today-day-ended')).toBeNull());
      expect(useOutbox.getState().answers).toEqual({});
      expect(useDrafts.getState().drafts['cq-old']).toBe(LATE);
      expect(mockSaveAnswer).not.toHaveBeenCalled();
      expect(r.getPathname()).toBe('/today');
    });

    it("Today shows no card for another user's or a still-queued answer", async () => {
      const outbox = useOutbox.getState();
      outbox.queueAnswer({
        coupleQuestionId: 'cq-x',
        userId: 'someone-else',
        body: LATE,
        clientWrittenAt: `${daysAgo(1)}T23:50:00Z`,
      });
      outbox.setAnswerStatus('cq-x', 'failed', 'DAY_ENDED');
      await renderRouter(APP_DIR, { initialUrl: '/today' });
      expect(await screen.findByText('What made you smile?')).toBeTruthy();
      expect(screen.queryByTestId('today-day-ended')).toBeNull();
    });
  });

  it('serves the dev-only component gallery at /dev/gallery (screen 54)', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/dev/gallery' });
    expect(r.getPathname()).toBe('/dev/gallery');
    expect(screen.getByTestId('gallery')).toBeTruthy();
  });

  it('routes an invite code link with its params', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/join/code?code=ABC123' });
    expect(r.getPathname()).toBe('/join/code');
    expect(r.getSearchParams()).toEqual({ code: 'ABC123' });
  });

  it('maps bonded:// links to app paths the way native does', () => {
    // The jest harness parses initialUrl web-style, so check the native parser directly.
    // Internal module: if an SDK upgrade moves it, update this import.
    const { extractExpoPathFromURL } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-router/build/fork/extractPathFromURL') as {
        extractExpoPathFromURL: (prefixes: string[], url: string) => string;
      };
    expect(extractExpoPathFromURL([], 'bonded://join/code?code=ABC123')).toBe(
      'join/code?code=ABC123',
    );
    expect(extractExpoPathFromURL([], 'bonded://today/reveal')).toBe('today/reveal');
  });
});
