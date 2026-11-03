import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as StoreReview from 'expo-store-review';
import type { ReactElement } from 'react';
import { Share } from 'react-native';

import type { Badge, BadgeAward } from '@/features/badges/api';
import { BadgeUnlockedSheet } from '@/features/badges/components/BadgeUnlockedSheet';
import BadgesScreen from '@/features/badges/screens/BadgesScreen';
import MilestoneScreen from '@/features/badges/screens/MilestoneScreen';
import { recordSession, setReviewStorage } from '@/features/review/review';
import { AppError } from '@/lib/errors';
import { memoryStorage } from '@/test/memoryStorage';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    mockRouter.replace(href);
    return null;
  },
}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({
      id: 'couple-1',
      partner_name: 'Sam',
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
jest.mock('@/features/daily/api', () => ({
  getStreak: () =>
    Promise.resolve({
      current: 12,
      longest: 12,
      last_completed_on: '2026-11-02',
      completed_today: true,
      at_risk: false,
      saver_available: false,
    }),
}));
const CATALOGUE: Badge[] = [1, 3, 7, 14, 21, 30, 50, 100, 365].map((n) => ({
  slug: `streak-${n}`,
  kind: 'streak',
  owner: 'shared',
  threshold: n,
  title: n === 7 ? 'First week' : n === 365 ? 'One year' : `${n} days`,
  description: 'd',
  priority: 'P0',
  status: 'placeholder',
}));
const AWARDS: BadgeAward[] = [1, 3, 7].map((n) => ({
  id: `a${n}`,
  badge_slug: `streak-${n}`,
  couple_id: 'couple-1',
  user_id: null,
  awarded_at: `2026-10-${20 + n}T10:00:00Z`,
}));
const mockCatalogue = jest.fn<Promise<Badge[]>, []>();
const mockAwards = jest.fn<Promise<BadgeAward[]>, []>();
jest.mock('@/features/badges/api', () => ({
  getBadgeCatalogue: () => mockCatalogue(),
  getBadgeAwards: () => mockAwards(),
}));

let qc: QueryClient;
function renderScreen(ui: ReactElement, options?: Parameters<typeof renderUi>[1]) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockParams = {};
  mockCatalogue.mockResolvedValue(CATALOGUE);
  mockAwards.mockResolvedValue(AWARDS);
  setReviewStorage(memoryStorage());
});
afterEach(() => qc.clear());

describe('25 milestone', () => {
  it('celebrates with a heavy haptic, confetti and the milestone copy', async () => {
    mockParams = { n: '30' };
    await renderScreen(<MilestoneScreen />);
    expect(screen.getByTestId('25-screen')).toBeTruthy();
    expect(screen.getByText('30 days of showing up for each other')).toBeTruthy();
    expect(screen.getByLabelText('30-day milestone')).toBeTruthy();
    expect(screen.getByTestId('25-confetti', { includeHiddenElements: true })).toBeTruthy();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('heavy');
  });

  it('has no confetti with reduced motion', async () => {
    mockParams = { n: '7' };
    await renderScreen(<MilestoneScreen />, { reducedMotion: true });
    expect(screen.queryByTestId('25-confetti', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('25-badge')).toBeTruthy();
  });

  it('shares a fixed line (no answer text)', async () => {
    mockParams = { n: '7' };
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderScreen(<MilestoneScreen />);
    await fireEvent.press(screen.getByTestId('25-share'));
    expect(share).toHaveBeenCalledWith({
      message: '7 days in a row on Bonded, answering one question a day together.',
    });
  });

  it('a bad step goes back to Today', async () => {
    mockParams = { n: '8' };
    await renderScreen(<MilestoneScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith('/today');
  });

  it('closing asks for the OS review, but never in the first session', async () => {
    jest.useFakeTimers();
    mockParams = { n: '7' };
    recordSession();
    let view = await renderScreen(<MilestoneScreen />);
    await fireEvent.press(screen.getByTestId('25-keep-going'));
    expect(mockRouter.back).toHaveBeenCalled();
    await view.unmount();
    await jest.runAllTimersAsync();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();

    recordSession();
    view = await renderScreen(<MilestoneScreen />);
    await view.unmount();
    await jest.runAllTimersAsync();
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });
});

describe('52b badge unlocked', () => {
  it('shows the step, the ladder with it earned, and closes', async () => {
    const onDismiss = jest.fn();
    await renderScreen(
      <BadgeUnlockedSheet days={3} current={3} earned={[1, 3]} onDismiss={onDismiss} />,
    );
    expect(screen.getByText('3-day badge unlocked!')).toBeTruthy();
    expect(screen.getByText('3 days in a row, together. Next up: 7 days.')).toBeTruthy();
    expect(screen.getByLabelText('3-day badge, earned')).toBeTruthy();
    expect(screen.getByLabelText('7-day badge, next, 43 percent')).toBeTruthy();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('heavy');
    await fireEvent.press(screen.getByTestId('52b-keep-going'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('day one and the last step have their own lines; reduced motion has no confetti', async () => {
    await renderScreen(
      <BadgeUnlockedSheet days={1} current={1} earned={[]} onDismiss={jest.fn()} />,
      { reducedMotion: true },
    );
    expect(screen.getByText('Your first day, together. Next up: 3 days in a row.')).toBeTruthy();
    expect(screen.queryByTestId('52b-confetti', { includeHiddenElements: true })).toBeNull();
  });

  it('is hidden without a step', async () => {
    await renderScreen(
      <BadgeUnlockedSheet days={null} current={0} earned={[]} onDismiss={jest.fn()} />,
    );
    expect(screen.queryByTestId('52b-badge')).toBeNull();
  });
});

describe('52 badges', () => {
  it('shows the ladder from awards and the grid with the next badge', async () => {
    await renderScreen(<BadgesScreen />);
    expect(await screen.findByTestId('52-grid')).toBeTruthy();
    expect(screen.getByText('3 of 9')).toBeTruthy();
    expect(screen.getByLabelText('3 of 9 badges earned')).toBeTruthy();
    expect(screen.getByText('Next: 14 days · 2 to go')).toBeTruthy();
    expect(screen.getByTestId('52-badge-streak-7-earned')).toBeTruthy();
    expect(screen.getByTestId('52-badge-streak-14-next')).toBeTruthy();
    expect(screen.getByLabelText('14 days, 2 days to go')).toBeTruthy();
    expect(screen.getByLabelText('One year, Locked')).toBeTruthy();
    expect(
      screen.getByText("Badges in your color are yours, sky blue are Sam's, gold are shared."),
    ).toBeTruthy();
  });

  it('renders at 200% text in dark mode', async () => {
    await renderScreen(<BadgesScreen />, { fontScale: 2, scheme: 'dark' });
    expect(await screen.findByTestId('52-grid')).toBeTruthy();
  });

  it('shows the error with a retry', async () => {
    mockAwards.mockRejectedValue(new AppError('UNKNOWN', 'Something went wrong.'));
    await renderScreen(<BadgesScreen />);
    expect(await screen.findByTestId('52-error')).toBeTruthy();
    mockAwards.mockResolvedValue(AWARDS);
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('52-grid')).toBeTruthy();
  });
});
