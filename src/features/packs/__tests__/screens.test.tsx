import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { PackDetail, PackSummary } from '@/features/packs/api';
import PackPreviewScreen from '@/features/packs/screens/PackPreviewScreen';
import PacksScreen from '@/features/packs/screens/PacksScreen';
import { AppError, toAppError } from '@/lib/errors';
import { purchasesMock } from '@/test/purchases';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({
      id: 'couple-1',
      partner_name: null,
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
type Row = { user_id: string; is_active: boolean; expires_at: string | null };
const mockEntitlements = jest.fn<Promise<Row[]>, []>();
jest.mock('@/features/premium/api', () => ({ getEntitlements: () => mockEntitlements() }));
const mockGetPacks = jest.fn<Promise<PackSummary[]>, []>();
const mockGetPack = jest.fn<Promise<PackDetail | null>, [string]>();
const mockStart = jest.fn<Promise<string>, [string]>();
const mockStarted = jest.fn<Promise<Record<string, string>>, [string[]]>();
jest.mock('@/features/packs/api', () => ({
  getPacks: () => mockGetPacks(),
  getPack: (id: string) => mockGetPack(id),
  startPackQuestion: (id: string) => mockStart(id),
  getStartedPackQuestions: (ids: string[]) => mockStarted(ids),
}));

const MINE: Row = { user_id: 'u1', is_active: true, expires_at: null };
const PARTNERS: Row = { user_id: 'u2', is_active: true, expires_at: null };
const EXPIRED: Row = { user_id: 'u1', is_active: true, expires_at: '2000-01-01T00:00:00Z' };

const pack = (slug: string, title: string, isPremium = true, count = 12): PackSummary => ({
  id: `p-${slug}`,
  slug,
  title,
  description: 'd',
  isPremium,
  icon: slug,
  questionCount: count,
});
const LIBRARY = [
  pack('deep-talks', 'Deep Talks'),
  pack('laugh-together', 'Laugh Together'),
  pack('future-us', 'Future Us'),
];

// Fixture text is distinctive so a leak is easy to find.
const FUTURE_US: PackDetail = {
  id: 'p-future-us',
  slug: 'future-us',
  title: 'Future Us',
  description: "Dreams, plans and the life you're building.",
  isPremium: true,
  icon: 'future-us',
  questions: [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `q${n}`,
    position: n,
    body: `FIXTURE-Q${n}`,
  })),
};

let qc: QueryClient;
function renderScreen(ui: ReactElement, options?: Parameters<typeof renderUi>[1]) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>, options);
}
const never = <T,>() => new Promise<T>(() => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockEntitlements.mockReset();
  mockEntitlements.mockResolvedValue([]);
  mockGetPacks.mockReset();
  mockGetPacks.mockResolvedValue(LIBRARY);
  mockGetPack.mockReset();
  mockGetPack.mockResolvedValue(FUTURE_US);
  mockStart.mockReset();
  mockStarted.mockReset();
  mockStarted.mockResolvedValue({});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  // Premium is the server's: RevenueCat is never asked on these screens.
  expect(purchasesMock.getOfferings).not.toHaveBeenCalled();
  expect(purchasesMock.purchasePackage).not.toHaveBeenCalled();
  qc.clear();
});

describe('32 Packs library', () => {
  it('loading: a skeleton, no grid', async () => {
    mockGetPacks.mockImplementation(never);
    await renderScreen(<PacksScreen />);
    expect(screen.getByTestId('32-loading')).toBeTruthy();
    expect(screen.queryByTestId('32-grid')).toBeNull();
  });

  it('error: the mapped message and a retry', async () => {
    mockGetPacks.mockRejectedValueOnce(new AppError('NETWORK', 'You seem to be offline.'));
    await renderScreen(<PacksScreen />);
    expect(await screen.findByTestId('32-error')).toBeTruthy();
    expect(screen.getByText('You seem to be offline.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('32-grid')).toBeTruthy();
  });

  it('empty: a mascot and a note, no grid', async () => {
    mockGetPacks.mockResolvedValue([]);
    await renderScreen(<PacksScreen />);
    expect(await screen.findByTestId('32-empty')).toBeTruthy();
    expect(screen.getByText('New packs are on their way')).toBeTruthy();
    expect(screen.getByLabelText('Bao and Bun, napping until the new packs arrive.')).toBeTruthy();
  });

  it('free couple (D51): every pack is Premium, the copy says so; a tile opens 33', async () => {
    await renderScreen(<PacksScreen />);
    expect(
      await screen.findByTestId('32-pack-future-us-lock', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Future Us, 12 questions, Premium')).toBeTruthy();
    expect(
      screen.getByText(
        'Your daily question is always free. Packs come with Premium, for both of you.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Free this week|^Free$|start free/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('32-pack-future-us'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/packs/[packId]',
      params: { packId: 'p-future-us' },
    });
  });

  it('"New this week": the first pack is featured (keeps its 32-pack id), never as free', async () => {
    // Even a pack still flagged is_premium = false is a Premium pack now (D51, BE-46).
    mockGetPacks.mockResolvedValue([pack('gratitude', 'Gratitude', false, 1), ...LIBRARY]);
    await renderScreen(<PacksScreen />);
    expect(await screen.findByTestId('32-featured')).toBeTruthy();
    expect(screen.getByText('New this week')).toBeTruthy();
    expect(screen.getByLabelText('Gratitude, new this week, 1 question, Premium')).toBeTruthy();
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.getByLabelText('Deep Talks, 12 questions, Premium')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('32-pack-gratitude'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/packs/[packId]',
      params: { packId: 'p-gratitude' },
    });
  });

  it('premium (mine): no locks', async () => {
    mockEntitlements.mockResolvedValue([MINE]);
    await renderScreen(<PacksScreen />);
    expect(await screen.findByText('Every pack is open for the two of you.')).toBeTruthy();
    expect(
      screen.queryByTestId('32-pack-future-us-lock', { includeHiddenElements: true }),
    ).toBeNull();
    expect(screen.getByLabelText('Future Us, 12 questions')).toBeTruthy();
    expect(screen.getByLabelText('Deep Talks, new this week, 12 questions')).toBeTruthy();
  });

  it("partner-premium: no locks, on the partner's plan", async () => {
    mockEntitlements.mockResolvedValue([PARTNERS]);
    await renderScreen(<PacksScreen />);
    expect(
      await screen.findByText("Every pack is open for the two of you, on Sam's plan."),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('32-pack-deep-talks-lock', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('an expired entitlement keeps the locks', async () => {
    mockEntitlements.mockResolvedValue([EXPIRED]);
    await renderScreen(<PacksScreen />);
    expect(
      await screen.findByTestId('32-pack-future-us-lock', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('premium unknown (server not answered or failed): locks stay', async () => {
    mockEntitlements.mockImplementation(never);
    await renderScreen(<PacksScreen />);
    expect(
      await screen.findByTestId('32-pack-future-us-lock', { includeHiddenElements: true }),
    ).toBeTruthy();
    qc.clear();
    mockEntitlements.mockRejectedValue(new AppError('NETWORK', 'offline'));
    await renderScreen(<PacksScreen />);
    expect(
      await screen.findByTestId('32-pack-future-us-lock', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('renders at 200% text in dark mode with reduced motion', async () => {
    await renderScreen(<PacksScreen />, { scheme: 'dark', fontScale: 2, reducedMotion: true });
    expect(await screen.findByTestId('32-grid')).toBeTruthy();
    expect(screen.getByText('Laugh Together')).toBeTruthy();
  });
});

describe('33 Pack preview', () => {
  beforeEach(() => {
    mockParams = { packId: 'p-future-us' };
  });

  it('loading: a skeleton', async () => {
    mockGetPack.mockImplementation(never);
    await renderScreen(<PackPreviewScreen />);
    expect(screen.getByTestId('33-loading')).toBeTruthy();
  });

  it('error: the message and a retry', async () => {
    mockGetPack.mockRejectedValueOnce(new AppError('UNKNOWN', 'Something went wrong.'));
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-error')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('33-title')).toBeTruthy();
  });

  it('a pack that is gone: say so, back to the library', async () => {
    mockGetPack.mockResolvedValue(null);
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-gone')).toBeTruthy();
    await fireEvent.press(screen.getByText('Back to packs'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/packs');
  });

  it('an empty pack: a note, nothing to unlock', async () => {
    mockGetPack.mockResolvedValue({ ...FUTURE_US, questions: [] });
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-empty')).toBeTruthy();
    expect(screen.queryByTestId('33-unlock')).toBeNull();
  });

  it('free couple (D51): a read-only sample, locked rows without text, every start opens 34', async () => {
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByText('FIXTURE-Q1')).toBeTruthy();
    expect(screen.getByText('A question from this pack')).toBeTruthy();
    expect(screen.queryByText(/Free preview|Answer this one together/)).toBeNull();
    // The sample is something to read: no button, no answer field.
    expect(screen.queryByTestId('33-start-free')).toBeNull();
    expect(screen.queryByTestId('33-question-1')).toBeNull();
    expect(screen.queryByRole('button', { name: /FIXTURE-Q1/ })).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('"type":"TextInput"');
    expect(screen.getByTestId('33-premium-chip')).toBeTruthy();
    // Three locked rows, the rest as a count; never the locked questions' text.
    expect(screen.getByLabelText('Question 2, locked. Premium')).toBeTruthy();
    expect(screen.getByTestId('33-locked-4')).toBeTruthy();
    expect(screen.queryByTestId('33-locked-5')).toBeNull();
    expect(screen.getByText('+2 more questions')).toBeTruthy();
    for (const n of [2, 3, 4, 5, 6]) {
      expect(screen.queryByText(`FIXTURE-Q${n}`, { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByLabelText(new RegExp(`FIXTURE-Q${n}`))).toBeNull();
    }
    expect(screen.getByText('One subscription covers Maya and Sam.')).toBeTruthy();

    const toPaywall = {
      pathname: '/paywall',
      params: { from: 'pack', pack: 'Future Us', packId: 'p-future-us' },
    };
    await fireEvent.press(screen.getByTestId('33-locked-3'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(toPaywall);
    await fireEvent.press(screen.getByTestId('33-unlock'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(toPaywall);
    // No start for a free couple ever reaches the server.
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStarted).toHaveBeenCalledWith(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
  });

  it('a pack still flagged free (is_premium = false) is locked the same way (BE-46)', async () => {
    mockGetPack.mockResolvedValue({ ...FUTURE_US, isPremium: false });
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-sample')).toBeTruthy();
    expect(screen.getByTestId('33-unlock')).toBeTruthy();
    expect(screen.queryByTestId('33-questions')).toBeNull();
    expect(screen.queryByText('FIXTURE-Q2')).toBeNull();
  });

  it('free couple: questions already started stay openable, straight to 19', async () => {
    mockStarted.mockResolvedValue({ q1: 'cq-1', q4: 'cq-4' });
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-started')).toBeTruthy();
    expect(screen.getByText("Questions you've started")).toBeTruthy();
    expect(screen.getByText('FIXTURE-Q4')).toBeTruthy();
    // The sample is the first question not started yet; the others stay locked.
    expect(screen.getByTestId('33-sample-question').props.children).toBe('FIXTURE-Q2');
    expect(screen.getByTestId('33-locked-3')).toBeTruthy();
    expect(screen.queryByText('FIXTURE-Q3')).toBeNull();
    await fireEvent.press(screen.getByTestId('33-started-4'));
    expect(mockRouter.push).toHaveBeenCalledWith('/history/cq-4/answer');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('the started rows cannot be read: still the sample and the locks, nothing breaks', async () => {
    mockStarted.mockRejectedValue(new AppError('NETWORK', 'offline'));
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-sample')).toBeTruthy();
    expect(screen.queryByTestId('33-started')).toBeNull();
    expect(screen.getByTestId('33-unlock')).toBeTruthy();
  });

  it('premium (mine): every question is open, no unlock button; a tap goes through the server', async () => {
    mockEntitlements.mockResolvedValue([MINE]);
    mockStart.mockResolvedValue('cq-5');
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-questions')).toBeTruthy();
    for (const n of [1, 2, 3, 4, 5, 6]) expect(screen.getByText(`FIXTURE-Q${n}`)).toBeTruthy();
    expect(screen.queryByTestId('33-unlock')).toBeNull();
    expect(screen.queryByTestId('33-locked')).toBeNull();
    expect(screen.queryByTestId('33-partner-plan')).toBeNull();
    // Premium: the started rows are never asked for (the server opens any question).
    expect(mockStarted).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('33-question-5'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/history/cq-5/answer'));
    expect(mockStart).toHaveBeenCalledWith('q5');
  });

  it('PREMIUM_REQUIRED from the server opens 34, never the question, and rechecks premium', async () => {
    // Premium here, but the server says the plan has ended.
    mockEntitlements.mockResolvedValue([MINE]);
    mockStart.mockRejectedValue(toAppError({ message: 'PREMIUM_REQUIRED', code: 'P0001' }));
    await renderScreen(<PackPreviewScreen />);
    await fireEvent.press(await screen.findByTestId('33-question-1'));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/paywall',
        params: { from: 'pack', pack: 'Future Us', packId: 'p-future-us' },
      }),
    );
    expect(mockRouter.push).not.toHaveBeenCalledWith(expect.stringMatching(/^\/history/));
    expect(screen.queryByTestId('33-start-error')).toBeNull();
    // The entitlement query is fetched again (once on mount, once after the refusal).
    await waitFor(() => expect(mockEntitlements).toHaveBeenCalledTimes(2));
  });

  it('premium here but not on the server (stale): PREMIUM_REQUIRED still opens 34', async () => {
    mockEntitlements.mockResolvedValue([MINE]);
    mockStart.mockRejectedValue(toAppError({ message: 'PREMIUM_REQUIRED', code: 'P0001' }));
    await renderScreen(<PackPreviewScreen />);
    await fireEvent.press(await screen.findByTestId('33-question-3'));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/paywall' }),
      ),
    );
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it("partner-premium: open, on the partner's plan", async () => {
    mockEntitlements.mockResolvedValue([PARTNERS]);
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByText("Open for you both on Sam's plan.")).toBeTruthy();
    expect(screen.getByText('FIXTURE-Q6')).toBeTruthy();
  });

  it('premium unknown: rows stay locked until the server answers', async () => {
    mockEntitlements.mockImplementation(never);
    await renderScreen(<PackPreviewScreen />);
    expect(await screen.findByTestId('33-locked')).toBeTruthy();
    expect(screen.queryByText('FIXTURE-Q2')).toBeNull();
  });

  it('QUESTION_UNAVAILABLE and offline show a message and stay', async () => {
    mockEntitlements.mockResolvedValue([MINE]);
    mockStart.mockRejectedValueOnce(toAppError({ message: 'QUESTION_UNAVAILABLE' }));
    await renderScreen(<PackPreviewScreen />);
    await fireEvent.press(await screen.findByTestId('33-question-1'));
    expect(await screen.findByTestId('33-start-error')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();

    mockStart.mockRejectedValueOnce(new AppError('NETWORK', 'You seem to be offline.'));
    await fireEvent.press(screen.getByTestId('33-question-1'));
    expect(await screen.findByText('You seem to be offline.')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('back goes back', async () => {
    await renderScreen(<PackPreviewScreen />);
    await fireEvent.press(await screen.findByTestId('33-top-back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('renders at 200% text in dark mode', async () => {
    await renderScreen(<PackPreviewScreen />, { scheme: 'dark', fontScale: 2 });
    expect(await screen.findByText('FIXTURE-Q1')).toBeTruthy();
  });
});
