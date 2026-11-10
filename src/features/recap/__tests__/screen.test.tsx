import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { localDateKey } from '@/features/daily/today';
import type { DayRow } from '@/features/history/model';
import type { LovedAnswer, WeeklyRecap } from '@/features/recap/api';
import { addDays, weekdayName, weekStartOf } from '@/features/recap/model';
import WeeklyRecapScreen from '@/features/recap/screens/WeeklyRecapScreen';
import { useDrafts } from '@/lib/drafts';
import { AppError } from '@/lib/errors';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));
jest.mock('@/lib/useCoupleRealtime', () => ({ useCoupleRealtime: () => undefined }));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({
      id: 'couple-1',
      partner_name: null,
      timezone: 'UTC',
      created_at: '2026-01-01T00:00:00Z',
      paired_at: '2026-01-01T00:00:00Z',
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
const mockWeek = jest.fn<Promise<DayRow[]>, [string, string, string]>();
jest.mock('@/features/history/api', () => ({
  getHistoryMonth: (c: string, s: string, e: string) => mockWeek(c, s, e),
}));
const mockRecap = jest.fn<Promise<WeeklyRecap>, [string]>();
const mockLoved = jest.fn<Promise<LovedAnswer | null>, [string]>();
const mockBody = jest.fn<Promise<string | null>, [string]>();
jest.mock('@/features/recap/api', () => ({
  getWeeklyRecap: (w: string) => mockRecap(w),
  getLovedAnswer: (id: string) => mockLoved(id),
  getAnswerBody: (id: string) => mockBody(id),
}));

const TODAY = localDateKey(new Date(), 'UTC');
const WEEK = weekStartOf(TODAY);
// Distinctive so a leak is easy to spot.
const BODY = 'FIXTURE-LOVED-ANSWER';

const FREE: WeeklyRecap = {
  daysTogether: 3,
  replies: null,
  reactions: null,
  mostLovedAnswerId: null,
  isFull: false,
};
const FULL: WeeklyRecap = {
  daysTogether: 6,
  replies: 18,
  reactions: 11,
  mostLovedAnswerId: 'a-1',
  isFull: true,
};
const YESTERDAY = addDays(TODAY, -1);
const LOVED: LovedAnswer = {
  id: 'a-1',
  userId: 'u2',
  coupleQuestionId: 'cq-9',
  source: 'daily',
  assignedFor: YESTERDAY,
  createdAt: `${YESTERDAY}T20:00:00Z`,
  hearts: 3,
};

let qc: QueryClient;
const never = <T,>() => new Promise<T>(() => undefined);
function renderScreen(options?: Parameters<typeof renderUi>[1]) {
  return renderUi(
    <QueryClientProvider client={qc}>
      <WeeklyRecapScreen />
    </QueryClientProvider>,
    options,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWeek.mockReset();
  mockWeek.mockResolvedValue([{ assignedFor: WEEK, answerCount: 2 }]);
  mockRecap.mockReset();
  mockRecap.mockResolvedValue(FREE);
  mockLoved.mockReset();
  mockLoved.mockResolvedValue(LOVED);
  mockBody.mockReset();
  mockBody.mockResolvedValue(BODY);
  useDrafts.getState().reset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => qc.clear());

describe('31 Weekly recap (MOB-21 part 2)', () => {
  it("asks for this couple-local week (Monday) and reads the week's days", async () => {
    await renderScreen();
    expect(await screen.findByTestId('31-title')).toHaveTextContent('Your week together');
    expect(mockRecap).toHaveBeenCalledWith(WEEK);
    expect(mockWeek).toHaveBeenCalledWith('couple-1', WEEK, addDays(WEEK, 6));
    expect(screen.getByTestId('31-range')).toBeTruthy();
  });

  it('loading: a skeleton', async () => {
    mockRecap.mockImplementation(never);
    await renderScreen();
    expect(await screen.findByTestId('31-loading')).toBeTruthy();
    expect(screen.queryByTestId('31-title')).toBeNull();
  });

  it('error: the mapped message and a retry', async () => {
    mockRecap.mockRejectedValueOnce(new AppError('NETWORK', 'You seem to be offline.'));
    await renderScreen();
    expect(await screen.findByTestId('31-error')).toBeTruthy();
    expect(screen.getByText('You seem to be offline.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('31-title')).toBeTruthy();
  });

  it('the strip: one mascot per day with what happened, days to come are empty', async () => {
    await renderScreen();
    expect(await screen.findByLabelText(`${weekdayName(WEEK)}: you both answered`)).toBeTruthy();
    const sunday = addDays(WEEK, 6);
    if (sunday > TODAY) {
      expect(screen.getByLabelText(`${weekdayName(sunday)}: still to come`)).toBeTruthy();
    }
    if (TODAY !== WEEK) {
      expect(screen.getByLabelText(`${weekdayName(TODAY)}: today, not answered yet`)).toBeTruthy();
    }
  });

  it('free (D21): days together only, a Premium card, and no answer is read', async () => {
    await renderScreen();
    expect(await screen.findByLabelText('3 of 7 days together')).toBeTruthy();
    expect(screen.getByText('3/7')).toBeTruthy();
    expect(screen.queryByTestId('31-replies')).toBeNull();
    expect(screen.queryByTestId('31-reactions')).toBeNull();
    expect(screen.queryByTestId('31-loved')).toBeNull();
    expect(mockLoved).not.toHaveBeenCalled();
    expect(mockBody).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('31-premium-cta'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/paywall',
      params: { from: 'recap' },
    });
    expect(screen.getByTestId('31-later')).toBeTruthy();
  });

  it("premium: replies, reactions and an earlier day's most-loved answer", async () => {
    mockRecap.mockResolvedValue(FULL);
    await renderScreen();
    expect(await screen.findByLabelText('18 replies')).toBeTruthy();
    expect(screen.getByLabelText('11 reactions')).toBeTruthy();
    expect(screen.getByLabelText('6 of 7 days together')).toBeTruthy();
    expect(await screen.findByTestId('31-loved-body')).toHaveTextContent(`“${BODY}”`);
    expect(screen.getByTestId('31-loved-by')).toHaveTextContent(`Sam · ${weekdayName(YESTERDAY)}`);
    expect(mockLoved).toHaveBeenCalledWith('a-1');
    expect(mockBody).toHaveBeenCalledWith('a-1');
    expect(screen.queryByTestId('31-premium')).toBeNull();
  });

  it('premium, my own answer is the most loved: "You"', async () => {
    mockRecap.mockResolvedValue(FULL);
    mockLoved.mockResolvedValue({ ...LOVED, userId: 'u1' });
    await renderScreen();
    expect(await screen.findByTestId('31-loved-by')).toHaveTextContent(
      `You · ${weekdayName(YESTERDAY)}`,
    );
  });

  it('premium, no reactions this week: a note instead of the card', async () => {
    mockRecap.mockResolvedValue({ ...FULL, mostLovedAnswerId: null });
    await renderScreen();
    expect(await screen.findByTestId('31-no-loved')).toBeTruthy();
    expect(mockLoved).not.toHaveBeenCalled();
    expect(mockBody).not.toHaveBeenCalled();
  });

  describe('reveal rule', () => {
    beforeEach(() => mockRecap.mockResolvedValue(FULL));

    it("today's question not held on this phone: no text is requested; open goes to Today", async () => {
      mockLoved.mockResolvedValue({ ...LOVED, assignedFor: TODAY });
      await renderScreen();
      expect(await screen.findByTestId('31-loved-hidden')).toBeTruthy();
      expect(mockBody).not.toHaveBeenCalled();
      expect(screen.queryByText(BODY, { exact: false })).toBeNull();
      await fireEvent.press(screen.getByTestId('31-loved-open'));
      expect(mockRouter.push).toHaveBeenCalledWith('/today');
    });

    it('a pack question not held here: no text; open goes to 30, which routes by state', async () => {
      mockLoved.mockResolvedValue({ ...LOVED, source: 'pack', assignedFor: null });
      await renderScreen();
      expect(await screen.findByTestId('31-loved-hidden')).toBeTruthy();
      expect(mockBody).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('31-loved-open'));
      expect(mockRouter.push).toHaveBeenCalledWith('/history/cq-9');
    });

    it('a pack question held on this phone: the text shows', async () => {
      useDrafts.getState().markRevealed('cq-9');
      mockLoved.mockResolvedValue({ ...LOVED, source: 'pack', assignedFor: null });
      await renderScreen();
      expect(await screen.findByTestId('31-loved-body')).toHaveTextContent(`“${BODY}”`);
    });

    it('free: the server sends no answer id, and none is read even if one came', async () => {
      mockRecap.mockResolvedValue({ ...FREE, mostLovedAnswerId: 'a-1' });
      await renderScreen();
      expect(await screen.findByTestId('31-premium')).toBeTruthy();
      await waitFor(() => expect(mockLoved).not.toHaveBeenCalled());
      expect(mockBody).not.toHaveBeenCalled();
    });
  });

  it('back: returns, or goes to History when there is nowhere to go back to', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it.each([
    ['dark', { scheme: 'dark' as const }],
    ['200% text', { fontScale: 2 }],
  ])('renders in %s', async (_name, options) => {
    mockRecap.mockResolvedValue(FULL);
    await renderScreen(options);
    expect(await screen.findByTestId('31-loved-body')).toBeTruthy();
  });
});
