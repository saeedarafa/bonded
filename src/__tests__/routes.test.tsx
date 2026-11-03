import { focusManager, QueryClient } from '@tanstack/react-query';
import type * as QueryModule from '@tanstack/react-query';
import type * as ReactModule from 'react';
import { Keyboard, Linking, Share } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useOnboarding } from '@/features/onboarding/store';
import { acceptInvite, invitePreview } from '@/features/pairing/api';
import { useMyInvite } from '@/features/pairing/hooks';
import { usePendingJoin } from '@/features/pairing/joinRequest';
import { useSeenBadges } from '@/features/badges/seen';
import { setPushStorage } from '@/features/push/registration';
import { setReviewStorage } from '@/features/review/review';
import { setSoftAskStorage } from '@/features/push/softAsk';
import { AppError } from '@/lib/errors';
import type * as RealtimeModule from '@/lib/realtime';
import { cacheStorage } from '@/lib/storage';
import { memoryStorage } from '@/test/memoryStorage';

// The auth gate reads the session through `features/auth/api` and the couple through
// `features/couple/api` (the only Supabase touchpoints), so both are controlled here.
let mockUser: { userId: string } | null = null;
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
    listener(mockUser);
    return () => undefined;
  },
  isAppleSignInAvailable: () => Promise.resolve(false),
}));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () => Promise.resolve(mockCouple),
  createCouple: () => {
    mockCouple = { id: 'couple-1', couple_members: [{ user_id: 'u1', left_at: null }] };
    return Promise.resolve('couple-1');
  },
  unpair: () => Promise.resolve(),
}));
// D36: the open invite in `pair_invites` (null = none) and the calls that make codes and links.
let mockOpenInvite: object | null = null;
const mockCreateInvite = jest.fn(() => {
  mockOpenInvite = { code: '4827', expiresAt: '2999-01-01T00:00:00Z', acceptedAt: null };
  return Promise.resolve({ code: '4827', expiresAt: '2999-01-01T00:00:00Z', token: 'tok' });
});
const mockInviteLink = jest.fn<Promise<object | null>, []>(() => Promise.resolve(null));
// D37 entries ship behind a code flag until BE-26 merges; the tests run with it on.
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
jest.mock('@/features/daily/api', () => ({
  NUDGE_AVAILABLE: false,
  getTodayQuestion: () =>
    Promise.resolve({ id: 'cq-1', answerCount: 0, question: 'What made you smile?', answers: [] }),
  getStreak: () => Promise.resolve(null),
  sendNudge: () => Promise.resolve(),
  getRevealedQuestion: jest.fn(),
  saveAnswer: () => Promise.resolve(),
  setAnswerReaction: () => Promise.resolve(),
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
jest.mock('@/features/thread/api', () => ({
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
]);
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
  ['/gift', '14'],
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
    usePendingInvite.getState().clear();
    // The soft-ask (09, J6) is once per device: each test starts on a fresh phone.
    setSoftAskStorage(memoryStorage());
    setPushStorage(memoryStorage());
    setReviewStorage(memoryStorage());
    mockAwards = [];
    useSeenBadges.setState({ seen: [] });
    mockOpenInvite = null;
    mockCreateInvite.mockClear();
    mockInviteLink.mockReset();
    mockInviteLink.mockResolvedValue(null);
    useMyInvite.getState().set(null);
    mockPendingRequests = [];
    mockMyRequest = { status: 'pending', expiresAt: FUTURE };
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

  it('J6 renders for a signed-in joiner and sends a signed-out one to sign-in', async () => {
    mockUser = { userId: 'u2' };
    let r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
    await expectScreen('J6');
    mockUser = null;
    r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
    await waitFor(() => expect(r.getPathname()).toBe('/join/sign-in'));
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

  it('walks the onboarding from the welcome screen to sign-in, keeping answers locally', async () => {
    useOnboarding.getState().reset();
    const r = await renderRouter(APP_DIR, { initialUrl: '/welcome' });
    await fireEvent.press(screen.getByTestId('01-start'));
    await waitFor(() => expect(r.getPathname()).toBe('/story/1'));
    // #37: the mascot describes this screen, not a partner's answer.
    expect(screen.getByLabelText('Bao and Bun, waiting for a quiet moment together.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('02-next'));
    await waitFor(() => expect(r.getPathname()).toBe('/story/2'));
    await fireEvent.press(screen.getByTestId('03-this_week'));
    expect(useOnboarding.getState().lastLearned).toBe('this_week');
    await fireEvent.press(screen.getByTestId('03-next'));
    await fireEvent.press(screen.getByTestId('04-next'));
    await waitFor(() => expect(r.getPathname()).toBe('/quiz/stage'));

    // The stage is required: Continue explains instead of moving on.
    await fireEvent.press(screen.getByTestId('05-next'));
    expect(screen.getByTestId('05-missing')).toBeTruthy();
    expect(r.getPathname()).toBe('/quiz/stage');
    await fireEvent.press(screen.getByTestId('05-dating'));
    await fireEvent.press(screen.getByTestId('05-next'));
    await waitFor(() => expect(r.getPathname()).toBe('/quiz/goals'));
    await fireEvent.press(screen.getByTestId('06-romance'));
    await fireEvent.press(screen.getByTestId('06-next'));
    await waitFor(() => expect(r.getPathname()).toBe('/quiz/names'));

    await fireEvent.press(screen.getByTestId('07-next'));
    expect(screen.getByTestId('07-missing')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('07-me'), 'Alex');
    await fireEvent.changeText(screen.getByTestId('07-partner'), 'Sam');
    expect(screen.getByTestId('07-bond-starts')).toHaveTextContent('Your bond starts on day 1');
    await fireEvent.press(screen.getByTestId('07-next'));
    await waitFor(() => expect(r.getPathname()).toBe('/sign-in'));
    expect(useOnboarding.getState()).toMatchObject({
      stage: 'dating',
      goals: ['romance'],
      displayName: 'Alex',
      partnerName: 'Sam',
    });
    useOnboarding.getState().reset();
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

    it('J3: a link fills the code, previews the inviter and goes on to sign-in', async () => {
      preview.mockResolvedValue(MAYA);
      const r = await renderRouter(APP_DIR, { initialUrl: `/j/BND4827?t=${TOKEN}` });
      await waitFor(() => expect(screen.getByTestId('join-code-found')).toBeTruthy());
      expect(preview).toHaveBeenCalledTimes(1);
      expect(preview).toHaveBeenCalledWith('4827', TOKEN);
      expect(screen.getByText("You're joining Maya")).toBeTruthy();
      expect(screen.getByText("Maya has already answered today's question.")).toBeTruthy();
      expect(usePendingInvite.getState().inviterName).toBe('Maya');
      await fireEvent.press(screen.getByTestId('join-code-continue'));
      await waitFor(() => expect(r.getPathname()).toBe('/join/sign-in'));
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
      usePendingInvite.getState().set({ code: '4827', token: TOKEN, inviterName: 'Maya' });
      await renderRouter(APP_DIR, { initialUrl: '/join/welcome' });
      expect(screen.getByText('Maya saved you a seat')).toBeTruthy();
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
      expect(accept).toHaveBeenCalledWith('4827', TOKEN);
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
        await waitFor(() => expect(accept).toHaveBeenCalledWith('4827', TOKEN));
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
      expect(accept).toHaveBeenCalledWith('4827', null);
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
        expect(accept).toHaveBeenCalledWith('4827', null);
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
        await waitFor(() => expect(accept).toHaveBeenCalledWith('4827', null));
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

      it('with the flag off (until BE-26 merges) none of the entries show', async () => {
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
        await waitFor(() => expect(accept).toHaveBeenCalledWith('4827', null));
        await waitFor(() => expect(r.getPathname()).toBe('/join/reminders'));
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

  it('opens an invite link on J3 with the code, remembering the token (cold start, signed out)', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz012345';
    jest.mocked(invitePreview).mockReturnValue(new Promise(() => undefined));
    const r = await renderRouter(APP_DIR, { initialUrl: `/j/BND4827?t=${token}` });
    await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    expect(r.getSearchParams()).toEqual({ code: '4827' });
    expect(usePendingInvite.getState()).toMatchObject({ code: '4827', token });
    expect(screen.getByTestId('J3-screen')).toBeTruthy();
  });

  it('opens a malformed invite link on J3 without a code', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/j/nonsense' });
    await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    expect(r.getSearchParams()).toEqual({});
    expect(usePendingInvite.getState().code).toBeNull();
  });

  it('shows tab labels and placeholder names from the English catalogue', async () => {
    mockUser = { userId: 'u1' };
    await renderRouter(APP_DIR, { initialUrl: '/history' });
    for (const label of ['Today', 'Packs', 'Us']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText('History').length).toBe(2); // tab label + placeholder name
    expect(screen.getByLabelText('Placeholder: History')).toBeTruthy();
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
