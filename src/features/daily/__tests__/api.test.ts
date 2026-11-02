import { getStreak, getTodayQuestion, sendNudge } from '@/features/daily/api';

const mockRpc = jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>();
const mockSelect = jest.fn<void, [string]>();
const mockSingle = jest.fn<Promise<unknown>, []>();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => mockRpc(name, args),
    from: () => ({
      select: (cols: string) => {
        mockSelect(cols);
        return { eq: () => ({ single: () => mockSingle() }) };
      },
    }),
  },
}));

beforeEach(() => jest.clearAllMocks());

const raise = (message: string) => ({ data: null, error: { message, code: 'P0001' } });

describe('getTodayQuestion', () => {
  it('assigns today, then reads who answered without any answer text', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'cq-1', answer_count: 1 }, error: null });
    mockSingle.mockResolvedValue({
      data: {
        id: 'cq-1',
        answer_count: 1,
        question: { body: 'What made you smile?' },
        answers: [{ user_id: 'u2', created_at: '2026-11-02T21:04:00Z' }],
      },
      error: null,
    });
    await expect(getTodayQuestion()).resolves.toEqual({
      id: 'cq-1',
      answerCount: 1,
      question: 'What made you smile?',
      answers: [{ userId: 'u2', createdAt: '2026-11-02T21:04:00Z' }],
    });
    expect(mockRpc).toHaveBeenCalledWith('get_daily_question', undefined);
    // Privacy: the Today select never names answers.body.
    expect(mockSelect.mock.calls[0]?.[0]).not.toMatch(/answers\([^)]*body/);
  });

  it.each(['NOT_PAIRED', 'LIBRARY_EXHAUSTED'] as const)('maps %s', async (kind) => {
    mockRpc.mockResolvedValue(raise(kind));
    await expect(getTodayQuestion()).rejects.toMatchObject({ kind });
  });
});

describe('getStreak', () => {
  it('returns the streak_state row', async () => {
    mockRpc.mockResolvedValue({ data: { current: 3, completed_today: null }, error: null });
    await expect(getStreak()).resolves.toEqual({ current: 3, completed_today: null });
    expect(mockRpc).toHaveBeenCalledWith('get_streak', undefined);
  });
});

describe('sendNudge (BE-10, contract only)', () => {
  it('maps NUDGE_LIMIT and names the partner for PARTNER_ALREADY_ANSWERED', async () => {
    mockRpc.mockResolvedValue(raise('NUDGE_LIMIT'));
    await expect(sendNudge()).rejects.toMatchObject({ kind: 'NUDGE_LIMIT' });
    mockRpc.mockResolvedValue(raise('PARTNER_ALREADY_ANSWERED'));
    const error = await sendNudge({ partner: 'Sam' }).catch((e: Error) => e);
    expect(error).toMatchObject({ kind: 'PARTNER_ALREADY_ANSWERED' });
    expect((error as Error).message).toContain('Sam');
  });
});
