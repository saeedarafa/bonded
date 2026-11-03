import { focusManager, QueryClient } from '@tanstack/react-query';
import type * as QueryModule from '@tanstack/react-query';
import type * as ReactModule from 'react';
import { Keyboard } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useOnboarding } from '@/features/onboarding/store';
import { acceptInvite, invitePreview } from '@/features/pairing/api';
import { useMyInvite } from '@/features/pairing/hooks';
import { useSeenBadges } from '@/features/badges/seen';
import { setPushStorage } from '@/features/push/registration';
import { setReviewStorage } from '@/features/review/review';
import { setSoftAskStorage } from '@/features/push/softAsk';
import { AppError } from '@/lib/errors';
import type * as RealtimeModule from '@/lib/realtime';
import { memoryStorage } from '@/test/memoryStorage';

// The auth gate reads the session through `features/auth/api` and the couple through
// `features/couple/api` (the only Supabase touchpoints), so both are controlled here.
let mockUser: { userId: string } | null = null;
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
jest.mock('@/features/pairing/api', () => ({
  createInvite: () =>
    Promise.resolve({ code: '4827', expiresAt: '2999-01-01T00:00:00Z', token: 'tok' }),
  getOpenInvite: () => Promise.resolve(null),
  invitePreview: jest.fn(),
  acceptInvite: jest.fn(),
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
      accept.mockResolvedValue('couple-1');
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
      accept.mockResolvedValue('couple-1');
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
      accept.mockRejectedValue(new AppError('INVITE_EXPIRED', 'Expired.'));
      usePendingInvite.getState().set({ code: '4827', token: null, inviterName: 'Maya' });
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/name' });
      await fireEvent.changeText(screen.getByTestId('J5-name'), 'Sam');
      await fireEvent.press(screen.getByTestId('J5-join'));
      await waitFor(() => expect(r.getPathname()).toBe('/join/code'));
    });

    it('12: a signed-in person joins by code and lands on You are paired', async () => {
      mockUser = { userId: 'u2' };
      accept.mockResolvedValue('couple-1');
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
