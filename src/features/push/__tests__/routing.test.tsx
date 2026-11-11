import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { saveRitualTime } from '@/features/push/api';
import { resetHandledPushes } from '@/features/push/routing';
import { usePushRoute } from '@/features/push/store';
import { setPushStorage } from '@/features/push/registration';
import { setSoftAskStorage } from '@/features/push/softAsk';
import { useDrafts } from '@/lib/drafts';
import { memoryStorage } from '@/test/memoryStorage';

// Tap routing per push type, warm and cold start, against the real app/ tree (MOB-15). Data comes
// from the same mocked feature APIs as src/__tests__/routes.test.tsx.
const CQ = '00000000-0000-4000-c000-000000000001';
const ME = 'u1';
const PARTNER = 'u2';

let mockUser: { userId: string } | null = { userId: ME };
let mockSessionListener: ((u: { userId: string } | null) => void) | null = null;
jest.mock('@/features/auth/api', () => ({
  subscribeToSession: (listener: (u: { userId: string } | null) => void) => {
    mockSessionListener = listener;
    listener(mockUser);
    return () => undefined;
  },
  isAppleSignInAvailable: () => Promise.resolve(false),
}));
// 09 comes before the invite, so its tests use a couple that is still solo.
let mockSolo = false;
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({
      id: 'couple-1',
      created_at: '2026-10-23T08:00:00Z',
      timezone: 'Europe/Berlin',
      couple_members: [
        { user_id: 'u1', left_at: null },
        ...(mockSolo ? [] : [{ user_id: 'u2', left_at: null }]),
      ],
    }),
  unpair: () => Promise.resolve(),
}));
jest.mock('@/features/profile/api', () => ({
  getCoupleProfiles: () =>
    Promise.resolve([
      { id: 'u1', display_name: 'Maya', avatar_url: null },
      { id: 'u2', display_name: 'Sam', avatar_url: null },
    ]),
  updateMyProfile: () => Promise.resolve(),
  deviceTimezone: () => 'Europe/Berlin',
}));
let mockAnswered: string[] = [];
jest.mock('@/features/daily/api', () => ({
  NUDGE_AVAILABLE: false,
  getTodayQuestion: () =>
    Promise.resolve({
      id: '00000000-0000-4000-c000-000000000001',
      answerCount: mockAnswered.length,
      question: 'What made you smile?',
      answers: mockAnswered.map((userId) => ({ userId, createdAt: '2026-11-02T20:00:00Z' })),
    }),
  getStreak: () => Promise.resolve(null),
  sendNudge: () => Promise.resolve(),
  getRevealedQuestion: () => new Promise(() => undefined),
  saveAnswer: () => Promise.resolve(),
  setAnswerReaction: () => Promise.resolve(),
  removeAnswerReaction: () => Promise.resolve(),
}));
jest.mock('@/lib/useCoupleRealtime', () => ({
  useCoupleRealtime: () => undefined,
  sendTypingSignal: () => undefined,
}));
jest.mock('@/features/thread/api', () => ({
  getThread: () => Promise.resolve([]),
  getUnreadCount: () => Promise.resolve(0),
  markThreadRead: () => Promise.resolve(),
  sendMessage: () => Promise.resolve(),
}));
jest.mock('@/features/pairing/api', () => ({
  createInvite: () =>
    Promise.resolve({ code: '4827', expiresAt: '2999-01-01T00:00:00Z', token: 'tok' }),
  getOpenInvite: () => Promise.resolve(null),
  invitePreview: jest.fn(),
  acceptInvite: jest.fn(),
}));
jest.mock('@/features/push/api', () => ({
  registerPushToken: jest.fn(() => Promise.resolve()),
  deletePushToken: jest.fn(() => Promise.resolve()),
  saveRitualTime: jest.fn(() => Promise.resolve()),
  PARTNER_RITUAL_AVAILABLE: false,
  getPartnerRitualTime: () => Promise.resolve(null),
}));
// J6 picks J8 or 13 from the server entitlements (MOB-47): a free couple here.
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => Promise.resolve([]),
  getOffer: () => Promise.resolve({ eligible: false, expiresAt: null }),
  getOfferClocks: () => Promise.resolve([]),
}));

type MockNotifications = typeof Notifications & {
  __setLastResponse: (r: unknown) => void;
  __emit: { response: (r: unknown) => void; received: (n: unknown) => void };
};
const N = jest.requireMock<MockNotifications>('expo-notifications');

const APP_DIR = './app';
let seq = 0;

function notification(data: Record<string, unknown>, title = 'Bonded', body = 'Hi') {
  seq += 1;
  return {
    date: 0,
    request: { identifier: `push-${seq}`, content: { title, body, data }, trigger: null },
  };
}
function tap(data: Record<string, unknown>) {
  return {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: notification(data),
  };
}

const PUSHES: [string, Record<string, unknown>, string[], string, string][] = [
  // [case, data, who answered, expected path, screen testID]
  [
    'partner_answered: 19',
    { type: 'partner_answered', url: `bonded://question/${CQ}` },
    [PARTNER],
    '/today/answer',
    '19-screen',
  ],
  [
    'both_answered: 20',
    { type: 'both_answered', url: `bonded://question/${CQ}` },
    [ME, PARTNER],
    '/today/reveal',
    '20-screen',
  ],
  [
    'thread_activity: 22',
    { type: 'thread_activity', url: `bonded://question/${CQ}/thread` },
    [ME, PARTNER],
    '/today/thread',
    '22-screen',
  ],
  ['ritual_reminder: 18', { type: 'ritual_reminder', url: 'bonded://today' }, [], '/today', ''],
  ['last_call: 18', { type: 'last_call', url: 'bonded://today' }, [], '/today', ''],
  ['nudge: 18', { type: 'nudge', url: 'bonded://today' }, [], '/today', ''],
  ['partner_joined: Today', { type: 'partner_joined', url: 'bonded://today' }, [], '/today', ''],
  [
    'little_thing: Today (24d)',
    { type: 'little_thing', url: 'bonded://today', gesture: 'kiss', gestures: { kiss: 3 } },
    [],
    '/today',
    '',
  ],
  ['partner_premium: 32', { type: 'partner_premium', url: 'bonded://packs' }, [], '/packs', ''],
  [
    'weekly_recap: 31',
    { type: 'weekly_recap', url: 'bonded://history/recap' },
    [],
    '/history/recap',
    '',
  ],
];

describe('push tap routing (MOB-15)', () => {
  beforeAll(async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
  }, 90_000);

  beforeEach(() => {
    mockUser = { userId: ME };
    mockAnswered = [];
    mockSolo = false;
    resetHandledPushes();
    usePushRoute.setState({ pending: null, banner: null });
    useDrafts.getState().reset();
    setPushStorage(memoryStorage());
    setSoftAskStorage(memoryStorage());
    N.__setLastResponse(null);
  });

  it.each(PUSHES)('warm: %s', async (_name, data, answered, path, testID) => {
    mockAnswered = answered;
    // Start somewhere else in the app, so every target is a real move.
    const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
    await act(async () => N.__emit.response(tap(data)));
    await waitFor(() => expect(r.getPathname()).toBe(path));
    if (testID) expect(await screen.findByTestId(testID)).toBeTruthy();
  });

  it.each(PUSHES)('cold start: %s', async (_name, data, answered, path) => {
    mockAnswered = answered;
    N.__setLastResponse(tap(data));
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe(path));
    expect(N.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('cold start: the launch tap is routed once, even if the listener reports it too', async () => {
    mockAnswered = [PARTNER];
    const response = tap({ type: 'partner_answered', url: `bonded://question/${CQ}` });
    N.__setLastResponse(response);
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/today/answer'));
    await act(async () => N.__emit.response(response));
    expect(usePushRoute.getState().pending).toBeNull();
    expect(r.getPathname()).toBe('/today/answer');
  });

  it('opens Today (21 once revealed here) for both_answered after the reveal on this device', async () => {
    mockAnswered = [ME, PARTNER];
    useDrafts.getState().markRevealed(CQ);
    const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
    await act(async () =>
      N.__emit.response(tap({ type: 'both_answered', url: `bonded://question/${CQ}` })),
    );
    await waitFor(() => expect(r.getPathname()).toBe('/today/revealed'));
  });

  it('ignores action buttons other than the default tap', async () => {
    const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
    await act(async () =>
      N.__emit.response({
        ...tap({ type: 'nudge', url: 'bonded://today' }),
        actionIdentifier: 'x',
      }),
    );
    expect(r.getPathname()).toBe('/us');
  });

  it('signed out: the tap waits through sign-in, then opens its screen', async () => {
    mockUser = null;
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
    await act(async () =>
      N.__emit.response(tap({ type: 'partner_premium', url: 'bonded://packs' })),
    );
    expect(r.getPathname()).toBe('/welcome');
    expect(usePushRoute.getState().pending).toBe('/packs');
    // What the sign-in screen (08) does on success: back to the front door, which opens Today.
    await act(async () => mockSessionListener?.({ userId: ME }));
    await act(async () => router.replace('/'));
    await waitFor(() => expect(r.getPathname()).toBe('/packs'));
  });

  describe('foreground (37)', () => {
    it('shows the in-app banner instead of the system one; a tap opens its screen', async () => {
      mockAnswered = [ME, PARTNER];
      const r = await renderRouter(APP_DIR, { initialUrl: '/us' });
      await act(async () =>
        N.__emit.received(
          notification(
            { type: 'thread_activity', url: `bonded://question/${CQ}/thread` },
            'Sam replied',
            'A preview',
          ),
        ),
      );
      const banner = await screen.findByTestId('37-banner');
      expect(screen.getByText('Sam replied')).toBeTruthy();
      expect(r.getPathname()).toBe('/us');
      await fireEvent.press(banner);
      await waitFor(() => expect(r.getPathname()).toBe('/today/thread'));
      expect(screen.queryByTestId('37-banner')).toBeNull();
    });

    it('stays quiet when the person is already on that screen', async () => {
      mockAnswered = [ME, PARTNER];
      await renderRouter(APP_DIR, { initialUrl: '/today/thread' });
      await screen.findByTestId('22-screen');
      await act(async () =>
        N.__emit.received(
          notification({ type: 'thread_activity', url: `bonded://question/${CQ}/thread` }),
        ),
      );
      expect(screen.queryByTestId('37-banner')).toBeNull();
    });

    it('presents foreground pushes in the list only (no system banner, no sound)', async () => {
      const handler = jest.mocked(Notifications.setNotificationHandler).mock.calls[0]?.[0];
      expect(handler).toBeTruthy();
      await expect(handler?.handleNotification(notification({}) as never)).resolves.toEqual({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      });
    });
  });

  describe('soft-ask screens (09, J6)', () => {
    type Perm = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
    const undetermined = {
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      expires: 'never',
    } as Perm;
    const granted = {
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as Perm;
    const getPerm = jest.mocked(Notifications.getPermissionsAsync);
    const request = jest.mocked(Notifications.requestPermissionsAsync);

    beforeEach(() => {
      getPerm.mockReset().mockResolvedValue(undetermined);
      mockSolo = true;
      request.mockClear();
      jest.mocked(saveRitualTime).mockClear();
    });

    it('09: no system prompt until "Turn on reminders"; then the time, the prompt, the invite', async () => {
      const r = await renderRouter(APP_DIR, { initialUrl: '/reminders' });
      expect(await screen.findByTestId('09-screen')).toBeTruthy();
      expect(screen.getByText('A gentle nudge, once a day')).toBeTruthy();
      expect(screen.getByTestId('09-preview')).toBeTruthy();
      expect(request).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('09-time-morning'));
      await fireEvent.press(screen.getByTestId('09-accept'));
      await waitFor(() => expect(r.getPathname()).toBe('/invite'));
      expect(request).toHaveBeenCalledTimes(1);
      expect(saveRitualTime).toHaveBeenCalledWith(ME, '08:00');
    });

    it('09: never asked twice (after accept or decline the route steps aside to the invite)', async () => {
      let r = await renderRouter(APP_DIR, { initialUrl: '/reminders' });
      await fireEvent.press(await screen.findByTestId('09-decline'));
      await waitFor(() => expect(r.getPathname()).toBe('/invite'));
      expect(request).not.toHaveBeenCalled();
      expect(saveRitualTime).not.toHaveBeenCalled();
      r = await renderRouter(APP_DIR, { initialUrl: '/reminders' });
      await waitFor(() => expect(r.getPathname()).toBe('/invite'));
      expect(screen.queryByTestId('09-accept')).toBeNull();
    });

    it('09: skipped when the OS already allowed notifications', async () => {
      getPerm.mockResolvedValue(granted);
      const r = await renderRouter(APP_DIR, { initialUrl: '/reminders' });
      await waitFor(() => expect(r.getPathname()).toBe('/invite'));
      expect(request).not.toHaveBeenCalled();
    });

    it('J6: 3 of 3, the default evening time, then the prompt and You are paired', async () => {
      mockSolo = false;
      const r = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      expect(await screen.findByTestId('J6-screen')).toBeTruthy();
      expect(await screen.findByTestId('J6-time-evening')).toBeTruthy();
      expect(request).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('J6-accept'));
      await waitFor(() => expect(r.getPathname()).toBe('/paired'));
      expect(request).toHaveBeenCalledTimes(1);
      expect(saveRitualTime).toHaveBeenCalledWith(ME, '21:00');
      const again = await renderRouter(APP_DIR, { initialUrl: '/join/reminders' });
      await waitFor(() => expect(again.getPathname()).toBe('/paired'));
      expect(request).toHaveBeenCalledTimes(1);
    });
  });
});
