import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type * as ReactModule from 'react';
import { AccessibilityInfo } from 'react-native';

import TodayScreen from '@/features/daily/screens/TodayScreen';
import type { SentLittleThing } from '@/features/littleThings/api';
import {
  useLittleThingsSeen,
  useLittleThingsTip,
  useLocalSoundOff,
} from '@/features/littleThings/hooks';
import {
  NOTHING_SENT,
  type LittleThingsToday,
  type ReceivedRow,
} from '@/features/littleThings/model';
import { useDrafts } from '@/lib/drafts';
import { renderUi } from '@/test/render';
import { gestureDurationMs } from '@/ui';
import { useToast } from '@/ui/components/Toast';

/** MOB-59: little things, receiving (24d; D48, D53) as a route test on Today. */

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
const mockRecent = jest.fn<Promise<ReceivedRow[]>, []>();
jest.mock('@/features/littleThings/api', () => ({
  ...jest.requireActual('@/features/littleThings/api'),
  sendLittleThing: (input: SendInput) => mockSend(input),
  undoLittleThing: (id: string) => mockUndo(id),
  getLittleThingsToday: () => mockToday(),
  getRecentLittleThings: () => mockRecent(),
}));

// 41 "Little things sounds" is notification_prefs.little_things_sound (BE-53, MOB-67).
let mockSoundPref = true;
const mockSavePrefs = jest.fn<Promise<void>, [string, object]>();
jest.mock('@/features/settings/api', () => ({
  ...jest.requireActual('@/features/settings/api'),
  getNotificationPrefs: () =>
    Promise.resolve({
      ...jest.requireActual('@/features/settings/api').DEFAULT_PREFS,
      little_things_sound: mockSoundPref,
    }),
  saveNotificationPrefs: (u: string, p: object) => mockSavePrefs(u, p),
}));

// The sound is scheduled in time with the hero's moment (MOB-66): one call per moment here.
const mockSound = jest.fn<void, [string, number]>();
const mockHaptic = jest.fn<() => void, [string, number]>(() => () => undefined);
jest.mock('@/features/littleThings/feedback', () => ({
  ...jest.requireActual('@/features/littleThings/feedback'),
  playGestureSoundsTimed: (kind: string, amount: number) => {
    mockSound(kind, amount);
    return () => undefined;
  },
  playGestureHaptic: (kind: string, amount: number) => mockHaptic(kind, amount),
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
  // Everything after 20:00 today is new on this phone.
  useLittleThingsSeen.setState({ seen: { u1: at(20, 0).toISOString() }, moment: null });
  mockSoundPref = true;
  mockSavePrefs.mockResolvedValue(undefined);
  useLocalSoundOff.setState({ pending: false });
  mockRecent.mockResolvedValue([]);
  useDrafts.getState().reset();
  useDrafts.getState().markRevealed('cq-1');
  useToast.setState({ toast: null });
});
afterEach(() => {
  qc.clear();
  jest.useRealTimers();
});

/** A row of `little_things`, `minsAgo` before 21:04. */
let seq = 0;
function row(
  senderId: string,
  kind: ReceivedRow['kind'],
  minsAgo: number,
  extra: Partial<ReceivedRow> = {},
): ReceivedRow {
  seq += 1;
  return {
    id: `g${seq}`,
    senderId,
    kind,
    amount: kind === 'hug' ? 3000 : 1,
    sameTime: false,
    createdAt: new Date(at(21, 4).getTime() - minsAgo * 60_000).toISOString(),
    ...extra,
  };
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function bubbleText() {
  await screen.findByTestId('24d-bubble');
  return screen.getByTestId('24d-text').props.children as string;
}

describe('24d the partner sent something', () => {
  it('nothing without the ship flag (D27)', async () => {
    mockShip = false;
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0, { amount: 3 })]);
    await show();
    await screen.findByTestId('24-screen');
    expect(mockRecent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
  });

  it('acts out 3 kisses: the hero kisses, bubble with Reply, sound and haptic once', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0, { amount: 3 })]);
    await show();
    expect(await bubbleText()).toBe('Sam sent you 3 kisses');
    expect(announce).toHaveBeenCalledWith('Sam sent you 3 kisses');
    expect(screen.getByTestId('24d-pose-kiss', { includeHiddenElements: true })).toBeTruthy();
    const reply = screen.getByTestId('24d-reply');
    expect(reply.props.accessibilityRole).toBe('button');
    expect(reply.props.accessibilityLabel).toBe('Kiss back');
    expect(mockSound).toHaveBeenCalledTimes(1);
    expect(mockSound).toHaveBeenCalledWith('kiss', 3);
    expect(mockHaptic).toHaveBeenCalledWith('kiss', 3);
  });

  it.each([
    ['a single kiss', row('u2', 'kiss', 1), 'Sam sent you a kiss'],
    ['a hug, in seconds', row('u2', 'hug', 1, { amount: 4200 }), 'Sam sent you a 4-second hug'],
    ['goodnight', row('u2', 'goodnight', 1), 'Sam says goodnight'],
    ['good morning', row('u2', 'good_morning', 1), 'Sam says good morning'],
    ['miss you', row('u2', 'miss_you', 1), 'Sam misses you'],
  ])('copy for %s', async (_name, r, text) => {
    mockRecent.mockResolvedValue([r]);
    await show();
    expect(await bubbleText()).toBe(text);
  });

  it('"You hugged at the same time" when the server says so (D48)', async () => {
    mockRecent.mockResolvedValue([
      row('u1', 'hug', 0.2),
      row('u2', 'hug', 0.1, { sameTime: true }),
    ]);
    await show();
    expect(await bubbleText()).toBe('You hugged at the same time');
  });

  it('"Sam kissed you back" when it answers my kiss', async () => {
    mockRecent.mockResolvedValue([row('u1', 'kiss', 3), row('u2', 'kiss', 1)]);
    await show();
    expect(await bubbleText()).toBe('Sam kissed you back');
  });

  it('groups what came while I was away, like the push; the newest one is acted out', async () => {
    mockRecent.mockResolvedValue([row('u2', 'hug', 1), row('u2', 'kiss', 30, { amount: 3 })]);
    await show();
    expect(await bubbleText()).toBe('Sam sent you 3 kisses and a hug');
    expect(screen.getByTestId('24d-pose-hug', { includeHiddenElements: true })).toBeTruthy();
    expect(mockSound).toHaveBeenCalledTimes(1);
    expect(mockSound).toHaveBeenCalledWith('hug', 3000);
  });

  it('never my own gestures, nor ones already seen', async () => {
    mockRecent.mockResolvedValue([row('u1', 'kiss', 1), row('u2', 'hug', 70)]);
    await show();
    await screen.findByTestId('24b-button');
    await waitFor(() => expect(mockRecent).toHaveBeenCalled());
    await advance(10);
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
    expect(mockSound).not.toHaveBeenCalled();
  });

  it('plays once: a refetch or coming back to Today does not replay it', async () => {
    mockRecent.mockResolvedValue([row('u2', 'goodnight', 1)]);
    const view = await show();
    await bubbleText();
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['little-things'] });
    });
    expect(mockSound).toHaveBeenCalledTimes(1);
    await view.unmount();
    await show();
    await screen.findByTestId('24b-button');
    await advance(10);
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
    expect(mockSound).toHaveBeenCalledTimes(1);
  });

  it('a new gesture over realtime plays as it arrives', async () => {
    await show();
    await screen.findByTestId('24b-button');
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
    mockRecent.mockResolvedValue([row('u2', 'miss_you', 0)]);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['little-things'] });
    });
    expect(await bubbleText()).toBe('Sam misses you');
  });

  it('sound off on 41 (server pref) is honoured; the haptic still plays', async () => {
    mockSoundPref = false;
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0)]);
    await show();
    await bubbleText();
    expect(mockSound).not.toHaveBeenCalled();
    expect(mockHaptic).toHaveBeenCalledWith('kiss', 1);
    expect(mockSavePrefs).not.toHaveBeenCalled();
  });

  it('a sound "off" saved on this phone (MOB-59) mutes Today and is copied to the server', async () => {
    useLocalSoundOff.setState({ pending: true });
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0)]);
    await show();
    await bubbleText();
    expect(mockSound).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockSavePrefs).toHaveBeenCalledWith('u1', { little_things_sound: false }),
    );
    await waitFor(() => expect(useLocalSoundOff.getState().pending).toBe(false));
    expect(mockSavePrefs).toHaveBeenCalledTimes(1);
  });

  it('Reduce Motion: the same still pose and bubble', async () => {
    mockRecent.mockResolvedValue([row('u2', 'goodnight', 0)]);
    await show({ reducedMotion: true });
    await bubbleText();
    expect(screen.getByTestId('24d-pose-goodnight', { includeHiddenElements: true })).toBeTruthy();
  });

  it('goes away after 12 s', async () => {
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0)]);
    await show();
    await bubbleText();
    await advance(11_000);
    expect(screen.getByTestId('24d-bubble')).toBeTruthy();
    await advance(1_500);
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
  });

  it('undone by Sam (realtime UPDATE, refetch): the bubble goes', async () => {
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0)]);
    await show();
    await bubbleText();
    mockRecent.mockResolvedValue([]);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['little-things'] });
    });
    await waitFor(() => expect(screen.queryByTestId('24d-bubble')).toBeNull());
  });

  it('works in dark mode at 200% text', async () => {
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0, { amount: 2 })]);
    await show({ scheme: 'dark', fontScale: 2 });
    expect(await bubbleText()).toBe('Sam sent you 2 kisses');
  });
});

describe('24d Reply', () => {
  it('sends the same back (3 kisses), then the Undo toast replaces the bubble', async () => {
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0, { amount: 3 })]);
    await show();
    await bubbleText();
    await fireEvent.press(screen.getByTestId('24d-reply'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0]?.[0]).toMatchObject({ kind: 'kiss', amount: 3 });
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
    expect(await screen.findByText('3 kisses sent to Sam')).toBeTruthy();
  });

  it('a hug back is as long as the hug', async () => {
    mockRecent.mockResolvedValue([row('u2', 'hug', 0, { amount: 4200 })]);
    await show();
    await bubbleText();
    await fireEvent.press(screen.getByTestId('24d-reply'));
    await waitFor(() =>
      expect(mockSend.mock.calls[0]?.[0]).toMatchObject({ kind: 'hug', amount: 4200 }),
    );
  });

  it('free couple at the kiss limit: Reply opens the paywall, nothing sent', async () => {
    mockToday.mockResolvedValue({ ...NOTHING_SENT, kiss: { atLimit: true, morePremium: true } });
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0)]);
    await show();
    await bubbleText();
    await waitFor(() => expect(mockToday).toHaveBeenCalled());
    await advance(10);
    await fireEvent.press(screen.getByTestId('24d-reply'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/paywall',
      params: { from: 'little_things' },
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('goodnight already sent: Reply says so, no paywall', async () => {
    mockToday.mockResolvedValue({
      ...NOTHING_SENT,
      goodnight: { atLimit: true, morePremium: false },
    });
    mockRecent.mockResolvedValue([row('u2', 'goodnight', 0)]);
    await show();
    await bubbleText();
    await waitFor(() => expect(mockToday).toHaveBeenCalled());
    await advance(10);
    await fireEvent.press(screen.getByTestId('24d-reply'));
    expect(useToast.getState().toast?.message).toBe('Goodnight already sent');
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("Bao and Bun act it out on Today's hero (MOB-66, D48)", () => {
  /** Today's 170 pt hero (24 bonded: "together"), not the 24 pt banner mascot. */
  const sizeOf = (n: { props: { width?: number; style?: unknown } }) =>
    n.props.width ?? (n.props.style as { width?: number } | undefined)?.width;
  const hero = () =>
    screen
      .getAllByRole('image')
      .find(
        (n) =>
          String(n.props.accessibilityLabel).startsWith('Bao and Bun, together') &&
          sizeOf(n) === 170,
      );
  const host = (n: unknown) => (n as { type: string }).type;

  it.each([
    ['hug', row('u2', 'hug', 0, { amount: 3000 })],
    ['kiss', row('u2', 'kiss', 0, { amount: 3 })],
    ['goodnight', row('u2', 'goodnight', 0)],
    ['good_morning', row('u2', 'good_morning', 0)],
    ['miss_you', row('u2', 'miss_you', 0)],
  ] as const)('%s plays its moment on the hero, then the mood comes back', async (kind, r) => {
    mockRecent.mockResolvedValue([r]);
    await show();
    await bubbleText();
    // Decorative: in the tree, hidden from screen readers; the hero keeps its state label.
    expect(screen.getByTestId(`24d-pose-${kind}`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId(`24d-pose-${kind}`)).toBeNull();
    expect(host(hero())).toBe('View');
    await advance(gestureDurationMs(kind, r.amount) + 400);
    expect(screen.queryByTestId(`24d-pose-${kind}`, { includeHiddenElements: true })).toBeNull();
    expect(hero()).toBeTruthy();
    // The bubble outlives the moment (12 s).
    expect(screen.getByTestId('24d-bubble')).toBeTruthy();
  });

  it('Reduce Motion: the still final pose on the hero, the same bubble', async () => {
    mockRecent.mockResolvedValue([row('u2', 'kiss', 0, { amount: 2 })]);
    await show({ reducedMotion: true });
    await bubbleText();
    expect(screen.getByTestId('24d-pose-kiss', { includeHiddenElements: true })).toBeTruthy();
    expect(host(hero())).toBe('RNSVGSvgView');
  });

  it('a second gesture restarts the moment', async () => {
    const kiss = row('u2', 'kiss', 1);
    mockRecent.mockResolvedValue([kiss]);
    await show();
    await bubbleText();
    expect(screen.getByTestId('24d-pose-kiss', { includeHiddenElements: true })).toBeTruthy();
    mockRecent.mockResolvedValue([row('u2', 'miss_you', 0), kiss]);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['little-things'] });
    });
    await waitFor(() =>
      expect(screen.getByTestId('24d-pose-miss_you', { includeHiddenElements: true })).toBeTruthy(),
    );
    await advance(gestureDurationMs('miss_you', 1) + 400);
    expect(screen.queryByTestId('24d-pose-miss_you', { includeHiddenElements: true })).toBeNull();
  });
});
