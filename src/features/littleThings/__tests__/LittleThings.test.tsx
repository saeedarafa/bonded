import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type * as ReactModule from 'react';

import TodayScreen from '@/features/daily/screens/TodayScreen';
import { LittleThingLimitError, type SentLittleThing } from '@/features/littleThings/api';
import { useLittleThingsTip } from '@/features/littleThings/hooks';
import { NOTHING_SENT, type LittleThingsToday } from '@/features/littleThings/model';
import { AppError, messageFor } from '@/lib/errors';
import { useDrafts } from '@/lib/drafts';
import { expectOnlyAllowedKeys, recordAnalytics } from '@/test/analytics';
import { renderUi } from '@/test/render';
import { gestureDurationMs } from '@/ui';
import { useToast } from '@/ui/components/Toast';

/** MOB-58: little things, sending (24b, 24c; D48, D53) as a route test on Today. */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof ReactModule>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
    Redirect: ({ href }: { href: string }) => {
      mockRouter.replace(href);
      return null;
    },
  };
});

// D27: a build switch, off by default (production); on per test.
let mockShip = true;
jest.mock('@/features/premium/features', () => {
  const actual = jest.requireActual('@/features/premium/features');
  const shipped = { ...actual.SHIPPED };
  Object.defineProperty(shipped, 'littleThings', { get: () => mockShip, enumerable: true });
  return { ...actual, SHIPPED: shipped };
});

jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/lib/useCoupleRealtime', () => ({ useCoupleRealtime: () => undefined }));
const DAY = 24 * 60 * 60 * 1000;
let mockMembers = [
  { user_id: 'u1', left_at: null },
  { user_id: 'u2', left_at: null },
];
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({
      id: 'couple-1',
      partner_name: 'Sam',
      created_at: new Date(Date.now() - 12 * DAY).toISOString(),
      paired_at: new Date(Date.now() - 12 * DAY).toISOString(),
      timezone: 'UTC',
      couple_members: mockMembers,
    }),
}));
jest.mock('@/features/profile/api', () => ({
  getCoupleProfiles: () =>
    Promise.resolve([
      { id: 'u1', display_name: 'Maya', avatar_url: null },
      { id: 'u2', display_name: 'Sam', avatar_url: null },
    ]),
}));
let mockAnswerCount = 2;
jest.mock('@/features/daily/api', () => ({
  NUDGE_AVAILABLE: false,
  getTodayQuestion: () =>
    Promise.resolve({
      id: 'cq-1',
      answerCount: mockAnswerCount,
      question: 'What made you smile?',
      answers:
        mockAnswerCount >= 1
          ? [{ id: 'a1', userId: 'u1', createdAt: new Date().toISOString() }]
          : [],
    }),
  getStreak: () =>
    Promise.resolve({
      current: 12,
      longest: 12,
      last_completed_on: null,
      completed_today: mockAnswerCount >= 2,
      at_risk: false,
      saver_available: false,
    }),
}));
jest.mock('@/features/thread/api', () => ({ getUnreadCount: () => Promise.resolve(0) }));
jest.mock('@/features/badges/api', () => ({
  getBadgeCatalogue: () => Promise.resolve([]),
  getBadgeAwards: () => Promise.resolve([]),
}));
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => Promise.resolve([]),
  getOffer: () => Promise.resolve({ eligible: false, expiresAt: null }),
}));

type SendInput = { kind: string; amount: number; clientId: string };
const mockSend = jest.fn<Promise<SentLittleThing>, [SendInput]>();
const mockUndo = jest.fn<Promise<LittleThingsToday>, [string]>();
const mockToday = jest.fn<Promise<LittleThingsToday>, []>();
jest.mock('@/features/littleThings/api', () => ({
  ...jest.requireActual('@/features/littleThings/api'),
  sendLittleThing: (input: SendInput) => mockSend(input),
  undoLittleThing: (id: string) => mockUndo(id),
  getLittleThingsToday: () => mockToday(),
  getRecentLittleThings: () => Promise.resolve([]),
}));

let qc: QueryClient;
const show = (opts?: Parameters<typeof renderUi>[1]) =>
  renderUi(
    <QueryClientProvider client={qc}>
      <TodayScreen />
    </QueryClientProvider>,
    opts,
  );

/** Local wall-clock time today (the icon follows the phone's clock). */
const at = (h: number, m: number) => new Date(2026, 10, 11, h, m, 0);

beforeEach(() => {
  jest.useFakeTimers({ now: at(21, 4) });
  jest.clearAllMocks();
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockShip = true;
  mockAnswerCount = 2;
  mockMembers = [
    { user_id: 'u1', left_at: null },
    { user_id: 'u2', left_at: null },
  ];
  mockToday.mockResolvedValue(NOTHING_SENT);
  mockSend.mockResolvedValue({ id: 'lt-1', sameTime: false, atLimit: false });
  mockUndo.mockResolvedValue(NOTHING_SENT);
  useLittleThingsTip.setState({ seen: true });
  useDrafts.getState().reset();
  useDrafts.getState().markRevealed('cq-1');
  useToast.setState({ toast: null });
});
afterEach(() => {
  qc.clear();
  jest.useRealTimers();
});

async function openFan() {
  const button = await screen.findByTestId('24b-button');
  await fireEvent.press(button);
  return screen.findByTestId('24c-fan');
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('24b the button', () => {
  it('is off without the ship flag (D27)', async () => {
    mockShip = false;
    await show();
    await screen.findByTestId('today-screen');
    expect(await screen.findByTestId('24-screen')).toBeTruthy();
    expect(screen.queryByTestId('24b-button')).toBeNull();
  });

  it('is on every Today state once both are in (18 your turn, 23 waiting, 24 bonded)', async () => {
    for (const count of [0, 1, 2]) {
      mockAnswerCount = count;
      const view = await show();
      expect(await screen.findByTestId('24b-button')).toBeTruthy();
      await view.unmount();
      qc.clear();
    }
  });

  it('is not there while the partner has not joined (sending needs a pair)', async () => {
    mockMembers = [{ user_id: 'u1', left_at: null }];
    await show();
    await screen.findByTestId('today-screen');
    await waitFor(() => expect(mockToday).not.toHaveBeenCalled());
    expect(screen.queryByTestId('24b-button')).toBeNull();
  });

  it('names the partner for screen readers', async () => {
    await show();
    const button = await screen.findByTestId('24b-button');
    expect(button.props.accessibilityLabel).toBe('Send Sam a little something');
    expect(button.props.accessibilityRole).toBe('button');
  });

  it.each([
    [at(4, 59), 'goodnight'],
    [at(5, 0), 'good_morning'],
    [at(10, 59), 'good_morning'],
    [at(11, 0), 'hug'],
    [at(19, 59), 'hug'],
    [at(20, 0), 'goodnight'],
  ])('shows the time-of-day icon at %s: %s', async (now, kind) => {
    jest.setSystemTime(now);
    await show({ reducedMotion: true });
    expect(await screen.findByTestId(`24b-icon-${kind}`)).toBeTruthy();
  });

  it('peeks at the other gestures, then comes back', async () => {
    await show();
    await screen.findByTestId('24b-icon-goodnight');
    // Every 4.2 s the icon turns away (200 ms), shows another gesture, turns back at 1.4 s.
    await advance(4300);
    expect(screen.getByTestId('24b-icon-goodnight')).toBeTruthy();
    await advance(200);
    expect(screen.getByTestId('24b-icon-hug')).toBeTruthy();
    await advance(1000);
    expect(screen.getByTestId('24b-icon-hug')).toBeTruthy();
    await advance(300);
    expect(screen.getByTestId('24b-icon-goodnight')).toBeTruthy();
    // The next peek shows the next one.
    await advance(2800);
    expect(screen.getByTestId('24b-icon-kiss')).toBeTruthy();
  });

  it('Reduce Motion: a still icon, no peek', async () => {
    await show({ reducedMotion: true });
    await screen.findByTestId('24b-icon-goodnight');
    for (let i = 0; i < 4; i++) {
      await advance(1000);
      expect(screen.getByTestId('24b-icon-goodnight')).toBeTruthy();
    }
  });

  it('shows the one-time tip until it is tapped or the fan opens, once per phone', async () => {
    useLittleThingsTip.setState({ seen: false });
    const view = await show();
    await screen.findByTestId('24b-button');
    await advance(1000);
    expect(
      screen.getByText(
        'Send Sam a little something. Tap for all five. Hold Hug for longer, tap Kiss again for more.',
      ),
    ).toBeTruthy();
    await openFan();
    expect(screen.queryByTestId('24b-tip')).toBeNull();
    expect(useLittleThingsTip.getState().seen).toBe(true);
    await view.unmount();
    await show();
    await screen.findByTestId('24b-button');
    await advance(1000);
    expect(screen.queryByTestId('24b-tip')).toBeNull();
  });

  it('the tip is a 44 pt target: content-sized, so hitSlop covers one caption line (MOB-25)', async () => {
    useLittleThingsTip.setState({ seen: false });
    await show();
    await screen.findByTestId('24b-button');
    await advance(1000);
    expect(screen.getByTestId('24b-tip').props.hitSlop).toBe(8);
  });
});

describe('24c the fan', () => {
  it('opens five items, the time-of-day one in the middle, and closes', async () => {
    await show();
    const fan = await openFan();
    expect(fan.props.accessibilityRole).toBe('menu');
    for (const kind of ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'])
      expect(screen.getByTestId(`24c-${kind}`).props.accessibilityRole).toBe('menuitem');
    expect(screen.getByTestId('24b-button').props.accessibilityLabel).toBe('Close little things');
    expect(screen.getByText('Goodnight')).toBeTruthy();
    expect(screen.getByText('Morning')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('24c-scrim'));
    expect(screen.queryByTestId('24c-fan')).toBeNull();
  });

  it('the VoiceOver escape gesture closes the open fan (MOB-25)', async () => {
    await show();
    let layer = await openFan();
    while (layer.parent && !layer.props.accessibilityViewIsModal) layer = layer.parent;
    expect(layer.props.accessibilityViewIsModal).toBe(true);
    await fireEvent(layer, 'accessibilityEscape');
    expect(screen.queryByTestId('24c-fan')).toBeNull();
    expect(screen.getByTestId('24b-button').props.accessibilityLabel).not.toBe(
      'Close little things',
    );
  });

  it('one tap sends goodnight, with an Undo toast for 3 s', async () => {
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-goodnight'));
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'goodnight', amount: 1 }),
      ),
    );
    expect(screen.queryByTestId('24c-fan')).toBeNull();
    expect(screen.getByText('Goodnight sent to Sam')).toBeTruthy();
    expect(screen.getByTestId('24c-undo')).toBeTruthy();
    await advance(3100);
    expect(screen.queryByTestId('24c-undo-toast')).toBeNull();
  });

  it('batches kisses: three taps send one batch of 3 after a 1 s pause', async () => {
    await show();
    await openFan();
    const kiss = screen.getByTestId('24c-kiss');
    await fireEvent.press(kiss);
    await advance(500);
    await fireEvent.press(kiss);
    await advance(500);
    await fireEvent.press(kiss);
    expect(screen.getByText('×3')).toBeTruthy();
    expect(screen.getByText('3 kisses')).toBeTruthy();
    expect(screen.getByTestId('24c-kiss').props.accessibilityLabel).toBe('3 kisses');
    await advance(900);
    expect(mockSend).not.toHaveBeenCalled();
    await advance(200);
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0]?.[0]).toMatchObject({ kind: 'kiss', amount: 3 });
    expect(screen.getByText('3 kisses sent to Sam')).toBeTruthy();
  });

  it('stops counting at 5 kisses', async () => {
    await show();
    await openFan();
    for (let i = 0; i < 7; i++) await fireEvent.press(screen.getByTestId('24c-kiss'));
    expect(screen.getByText('×5')).toBeTruthy();
    expect(screen.getByText('5 is the most')).toBeTruthy();
    await advance(1100);
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0]?.[0]).toMatchObject({ kind: 'kiss', amount: 5 });
  });

  it('a hug lasts as long as the hold: 2.5 s held sends 2500 ms', async () => {
    await show();
    await openFan();
    const hug = screen.getByTestId('24c-hug');
    await fireEvent(hug, 'pressIn');
    await advance(2500);
    expect(screen.getByText('2.5 s')).toBeTruthy();
    expect(screen.getByTestId('24c-hug-ring')).toBeTruthy();
    await fireEvent(hug, 'pressOut');
    await fireEvent.press(hug);
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0]?.[0]).toMatchObject({ kind: 'hug', amount: 2500 });
    expect(screen.getByText('3-second hug sent to Sam')).toBeTruthy();
  });

  it('a hug stops at 5 s and sends by itself', async () => {
    await show();
    await openFan();
    await fireEvent(screen.getByTestId('24c-hug'), 'pressIn');
    await advance(6000);
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0]?.[0]).toMatchObject({ kind: 'hug', amount: 5000 });
  });

  it('a tap on Hug (Reduce Motion, screen readers) sends a short hug', async () => {
    await show({ reducedMotion: true });
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-hug'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0]?.[0]).toMatchObject({ kind: 'hug', amount: 2000 });
  });

  it('analytics (MOB-24d): little_thing_undone with the kind only', async () => {
    const rec = recordAnalytics();
    try {
      await show();
      await openFan();
      await fireEvent.press(screen.getByTestId('24c-miss_you'));
      await waitFor(() => expect(screen.getByTestId('24c-undo')).toBeTruthy());
      await fireEvent.press(screen.getByTestId('24c-undo'));
      await waitFor(() => expect(rec.of('little_thing_undone')).toEqual([{ kind: 'miss_you' }]));
      expectOnlyAllowedKeys(rec.captured);
    } finally {
      rec.stop();
    }
  });

  it('Undo takes it back with the id from the send', async () => {
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-miss_you'));
    await waitFor(() => expect(screen.getByTestId('24c-undo')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('24c-undo'));
    await waitFor(() => expect(mockUndo).toHaveBeenCalledWith('lt-1'));
    expect(screen.queryByTestId('24c-undo-toast')).toBeNull();
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe("Taken back. Sam won't see it."),
    );
  });

  it("my gesture: Bao acts it out on my Today's hero (prototype), Undo stops it (MOB-66)", async () => {
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-goodnight'));
    await waitFor(() => expect(screen.getByTestId('24c-undo')).toBeTruthy());
    const pose = screen.getByTestId('24c-pose-goodnight', { includeHiddenElements: true });
    expect(pose).toBeTruthy();
    expect(screen.queryByTestId('24c-pose-goodnight')).toBeNull();
    await fireEvent.press(screen.getByTestId('24c-undo'));
    await waitFor(() =>
      expect(
        screen.queryByTestId('24c-pose-goodnight', { includeHiddenElements: true }),
      ).toBeNull(),
    );
  });

  it('my moment ends by itself after its length (MOB-66)', async () => {
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-miss_you'));
    await waitFor(() =>
      expect(screen.getByTestId('24c-pose-miss_you', { includeHiddenElements: true })).toBeTruthy(),
    );
    await advance(gestureDurationMs('miss_you', 1) + 400);
    expect(screen.queryByTestId('24c-pose-miss_you', { includeHiddenElements: true })).toBeNull();
  });

  it('Undo too late says so (UNDO_EXPIRED)', async () => {
    mockUndo.mockRejectedValue(new AppError('UNDO_EXPIRED', messageFor('UNDO_EXPIRED')));
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-goodnight'));
    await waitFor(() => expect(screen.getByTestId('24c-undo')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('24c-undo'));
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe("Too late to undo. It's already on its way."),
    );
  });

  it('each gesture gets its own client id', async () => {
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-goodnight'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-miss_you'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    const [a, b] = mockSend.mock.calls.map((c) => c[0].clientId);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it('a network retry reuses the same client id', async () => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockSend
      .mockRejectedValueOnce(new AppError('NETWORK', messageFor('NETWORK')))
      .mockResolvedValueOnce({ id: 'lt-2', sameTime: false, atLimit: false });
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-goodnight'));
    await advance(1000);
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    expect(mockSend.mock.calls[1]?.[0].clientId).toBe(mockSend.mock.calls[0]?.[0].clientId);
  });

  it('same-time hug: the toast says so', async () => {
    mockSend.mockResolvedValue({ id: 'lt-1', sameTime: true, atLimit: false });
    await show({ reducedMotion: true });
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-hug'));
    await waitFor(() => expect(screen.getByText('You hugged at the same time')).toBeTruthy());
  });
});

describe('24c in dark and at 200% text', () => {
  it.each([
    ['dark', { scheme: 'dark' as const }],
    ['200%', { fontScale: 2 }],
  ])('%s: the fan opens and every label is readable', async (_name, opts) => {
    await show(opts);
    await openFan();
    for (const label of ['Hug', 'Kiss', 'Goodnight', 'Morning', 'Miss you'])
      expect(screen.getByText(label)).toBeTruthy();
  });
});

describe('24c limits (the server decides)', () => {
  it('free at the kiss limit: grey "More kisses with Premium" opens the paywall', async () => {
    mockToday.mockResolvedValue({ ...NOTHING_SENT, kiss: { atLimit: true, morePremium: true } });
    await show();
    await openFan();
    await waitFor(() => expect(screen.getByText('More kisses with Premium')).toBeTruthy());
    const kiss = screen.getByTestId('24c-kiss');
    expect(kiss.props.accessibilityLabel).toBe('Kiss, More kisses with Premium');
    expect(kiss.props.accessibilityHint).toBe('Opens Premium');
    await fireEvent.press(kiss);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/paywall',
      params: { from: 'little_things' },
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('24c-fan')).toBeNull();
  });

  it('goodnight already sent: grey, no paywall, nothing sent', async () => {
    mockToday.mockResolvedValue({
      ...NOTHING_SENT,
      goodnight: { atLimit: true, morePremium: false },
    });
    await show();
    await openFan();
    await waitFor(() => expect(screen.getByText('Goodnight already sent')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('24c-goodnight'));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByTestId('24c-fan')).toBeTruthy();
  });

  it('Premium at the hug limit: grey, never a paywall', async () => {
    mockToday.mockResolvedValue({ ...NOTHING_SENT, hug: { atLimit: true, morePremium: false } });
    await show();
    await openFan();
    await waitFor(() => expect(screen.getByText('Plenty for today')).toBeTruthy());
    await fireEvent(screen.getByTestId('24c-hug'), 'pressIn');
    await advance(1500);
    await fireEvent(screen.getByTestId('24c-hug'), 'pressOut');
    await fireEvent.press(screen.getByTestId('24c-hug'));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('a send that reaches the limit greys the item (at_limit), no countdown', async () => {
    let server: LittleThingsToday = NOTHING_SENT;
    mockToday.mockImplementation(() => Promise.resolve(server));
    mockSend.mockImplementation(() => {
      server = { ...NOTHING_SENT, miss_you: { atLimit: true, morePremium: true } };
      return Promise.resolve({ id: 'lt-1', sameTime: false, atLimit: true });
    });
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-miss_you'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    await openFan();
    await waitFor(() => expect(screen.getByText('More with Premium')).toBeTruthy());
    expect(screen.queryByText(/left/)).toBeNull();
  });

  it('a refused kiss batch (LITTLE_THING_LIMIT) drops the toast and says to try fewer', async () => {
    mockSend.mockRejectedValue(new LittleThingLimitError('kiss', true));
    await show();
    await openFan();
    await fireEvent.press(screen.getByTestId('24c-kiss'));
    await fireEvent.press(screen.getByTestId('24c-kiss'));
    await advance(1100);
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe(
        "That's more kisses than today allows. Try fewer.",
      ),
    );
    expect(screen.queryByTestId('24c-undo-toast')).toBeNull();
  });
});
