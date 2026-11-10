import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type * as ReactModule from 'react';

import type { Badge, BadgeAward } from '@/features/badges/api';
import { useSeenBadges } from '@/features/badges/seen';
import TodayScreen from '@/features/daily/screens/TodayScreen';
import type { FeedbackInput } from '@/features/feedback/api';
import { useCheckIn } from '@/features/feedback/checkIn';
import { CheckInSheet } from '@/features/feedback/components/CheckInSheet';
import { CHECK_IN_INTERVAL_MS } from '@/features/feedback/model';
import { AppError } from '@/lib/errors';
import { useDrafts } from '@/lib/drafts';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui/components/Toast';

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
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/lib/useCoupleRealtime', () => ({ useCoupleRealtime: () => undefined }));
const DAY = 24 * 60 * 60 * 1000;
let mockPairedDaysAgo = 40;
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({
      id: 'couple-1',
      partner_name: 'Sam',
      created_at: new Date(Date.now() - mockPairedDaysAgo * DAY).toISOString(),
      paired_at: new Date(Date.now() - mockPairedDaysAgo * DAY).toISOString(),
      timezone: 'UTC',
      couple_members: [
        { user_id: 'u1', left_at: null },
        { user_id: 'u2', left_at: null },
      ],
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
      answers: [{ id: 'a1', userId: 'u1', createdAt: new Date().toISOString() }],
    }),
  getStreak: () =>
    Promise.resolve({
      current: 12,
      longest: 12,
      last_completed_on: null,
      completed_today: true,
      at_risk: false,
      saver_available: false,
    }),
}));
jest.mock('@/features/thread/api', () => ({
  getUnreadCount: () => Promise.resolve(0),
}));
let mockAwards: BadgeAward[] = [];
jest.mock('@/features/badges/api', () => ({
  getBadgeCatalogue: () =>
    Promise.resolve(
      [1, 3, 7].map((n): Badge => ({
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
jest.mock('@/features/premium/api', () => ({
  getEntitlements: () => Promise.resolve([]),
  getOffer: () => Promise.resolve({ eligible: false, expiresAt: null }),
  getOfferClocks: () => Promise.resolve([]),
}));
const mockSend = jest.fn<Promise<void>, [FeedbackInput]>();
jest.mock('@/features/feedback/api', () => ({
  ...jest.requireActual('@/features/feedback/api'),
  sendFeedback: (input: FeedbackInput) => mockSend(input),
}));

let qc: QueryClient;
const show = (ui: ReactModule.ReactElement, opts?: Parameters<typeof renderUi>[1]) =>
  renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>, opts);

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockPairedDaysAgo = 40;
  mockAnswerCount = 2;
  mockAwards = [];
  mockSend.mockResolvedValue(undefined);
  useCheckIn.setState({ asked: {} });
  useSeenBadges.setState({ seen: [] });
  useDrafts.getState().reset();
  useDrafts.getState().markRevealed('cq-1');
  useToast.setState({ toast: null });
});
afterEach(() => qc.clear());

describe('26 Monthly check-in sheet', () => {
  const onDismiss = jest.fn();

  it('renders the board: question, promise, five faces, Send and Skip', async () => {
    await show(<CheckInSheet visible onDismiss={onDismiss} />);
    expect(screen.getByText('How is Bonded for you two this month?')).toBeTruthy();
    expect(screen.getByText('Your answer goes to our small team, not the app store.')).toBeTruthy();
    for (const label of ['Very unhappy', 'Unhappy', 'Okay', 'Happy', 'Love it'])
      expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByTestId('26-scale').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByTestId('26-face-4').props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('26-send')).toBeTruthy();
    expect(screen.getByTestId('26-skip')).toBeTruthy();
  });

  it('picking a face selects only that one', async () => {
    await show(<CheckInSheet visible onDismiss={onDismiss} />);
    await fireEvent.press(screen.getByTestId('26-face-2'));
    await fireEvent.press(screen.getByTestId('26-face-4'));
    expect(screen.getByTestId('26-face-4').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId('26-face-2').props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  it('Send stores a private check_in score, thanks and closes; never the store', async () => {
    await show(<CheckInSheet visible onDismiss={onDismiss} />);
    await fireEvent.press(screen.getByTestId('26-face-4'));
    await fireEvent.press(screen.getByTestId('26-send'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expect(mockSend).toHaveBeenCalledWith({
      userId: 'u1',
      kind: 'check_in',
      score: 4,
      tags: [],
      body: '',
    });
    expect(useToast.getState().toast?.message).toBe('Thanks for telling us.');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('Send without a face says so and sends nothing', async () => {
    await show(<CheckInSheet visible onDismiss={onDismiss} />);
    await fireEvent.press(screen.getByTestId('26-send'));
    expect(screen.getByTestId('26-pick')).toHaveTextContent('Pick a face first.');
    expect(mockSend).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('26-face-1'));
    expect(screen.queryByTestId('26-pick')).toBeNull();
  });

  it('a failed send stays open with the reason', async () => {
    mockSend.mockRejectedValueOnce(new AppError('NETWORK', 'You seem to be offline.'));
    await show(<CheckInSheet visible onDismiss={onDismiss} />);
    await fireEvent.press(screen.getByTestId('26-face-5'));
    await fireEvent.press(screen.getByTestId('26-send'));
    expect(await screen.findByTestId('26-error')).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Skip closes without sending', async () => {
    await show(<CheckInSheet visible onDismiss={onDismiss} />);
    await fireEvent.press(screen.getByTestId('26-skip'));
    expect(onDismiss).toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each([
    ['dark', { scheme: 'dark' as const }],
    ['200% text', { fontScale: 2 }],
  ])('renders in %s', async (_name, opts) => {
    await show(<CheckInSheet visible onDismiss={onDismiss} />, opts);
    expect(screen.getByTestId('26-face-5')).toBeTruthy();
    expect(screen.getByTestId('26-send')).toBeTruthy();
  });
});

describe('26 on Today: when it opens', () => {
  it('opens once on a bonded, revealed day from day 30, and remembers it asked', async () => {
    await show(<TodayScreen />);
    expect(await screen.findByTestId('26-sheet')).toBeTruthy();
    expect(useCheckIn.getState().lastAskedAt('u1')).not.toBeNull();
    await fireEvent.press(screen.getByTestId('26-skip'));
    await waitFor(() => expect(screen.queryByTestId('26-sheet')).toBeNull());
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('not again within 30 days', async () => {
    useCheckIn.getState().markAsked('u1', Date.now() - CHECK_IN_INTERVAL_MS + DAY);
    await show(<TodayScreen />);
    expect(await screen.findByTestId('24-screen')).toBeTruthy();
    expect(screen.queryByTestId('26-sheet')).toBeNull();
  });

  it('not before day 30 together', async () => {
    mockPairedDaysAgo = 10;
    await show(<TodayScreen />);
    await screen.findByTestId('24-screen');
    expect(screen.queryByTestId('26-sheet')).toBeNull();
    expect(useCheckIn.getState().lastAskedAt('u1')).toBeNull();
  });

  it('not before the reveal, nor while waiting on the partner', async () => {
    useDrafts.getState().reset();
    await show(<TodayScreen />);
    await screen.findByTestId('24-screen');
    expect(screen.queryByTestId('26-sheet')).toBeNull();
    useDrafts.getState().markRevealed('cq-1');
    mockAnswerCount = 1;
    qc.clear();
    await show(<TodayScreen />);
    await screen.findByTestId('today-me');
    expect(screen.queryByTestId('26-sheet')).toBeNull();
  });

  it('never over a new badge (52b)', async () => {
    mockAwards = [
      {
        id: 'aw-3',
        badge_slug: 'streak-3',
        couple_id: 'couple-1',
        user_id: null,
        awarded_at: new Date().toISOString(),
      },
    ];
    await show(<TodayScreen />);
    expect(await screen.findByText('3-day badge unlocked!')).toBeTruthy();
    expect(screen.queryByTestId('26-sheet')).toBeNull();
  });
});
