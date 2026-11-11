import {
  getRevealedQuestion,
  getStreak,
  getTodayQuestion,
  removeAnswerReaction,
  saveAnswer,
  sendNudge,
  setAnswerReaction,
} from '@/features/daily/api';

const mockRpc = jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>();
const mockSelect = jest.fn<void, [string]>();
const mockSingle = jest.fn<Promise<unknown>, []>();
const mockWrite = jest.fn<Promise<unknown>, [string, string, ...unknown[]]>();
const mockEq = jest.fn<void, [string, unknown]>();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => mockRpc(name, args),
    from: (table: string) => ({
      select: (cols: string) => {
        mockSelect(cols);
        return {
          eq: (col: string, value: unknown) => {
            mockEq(col, value);
            return { single: () => mockSingle() };
          },
        };
      },
      upsert: (row: unknown, options: unknown) => mockWrite(table, 'upsert', row, options),
      delete: () => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (c2: string, v2: unknown) => mockWrite(table, 'delete', { [c1]: v1, [c2]: v2 }),
        }),
      }),
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

describe('getRevealedQuestion (screen 21)', () => {
  it('reads both answers with their reactions for one question', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'cq-1',
        answer_count: 2,
        question: { body: 'What made you smile?' },
        answers: [
          {
            id: 'a2',
            user_id: 'u2',
            body: 'Your laugh.',
            created_at: '2026-11-02T21:04:00Z',
            reactions: [{ id: 'r1', user_id: 'u1', kind: '❤️' }],
          },
        ],
      },
      error: null,
    });
    await expect(getRevealedQuestion('cq-1')).resolves.toEqual({
      id: 'cq-1',
      answerCount: 2,
      question: 'What made you smile?',
      answers: [
        {
          id: 'a2',
          userId: 'u2',
          body: 'Your laugh.',
          voice: null,
          createdAt: '2026-11-02T21:04:00Z',
          reactions: [{ id: 'r1', userId: 'u1', kind: '❤️' }],
        },
      ],
    });
    expect(mockEq).toHaveBeenCalledWith('id', 'cq-1');
    expect(mockSelect.mock.calls[0]?.[0]).toMatch(/answers\([^)]*body/);
    expect(mockSelect.mock.calls[0]?.[0]).toMatch(
      /answers\([^)]*kind, voice_path, voice_duration_ms/,
    );
  });

  it('a voice answer (D46) carries its object and length, with the neutral text', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'cq-1',
        answer_count: 2,
        question: { body: 'Q' },
        answers: [
          {
            id: 'a2',
            user_id: 'u2',
            body: null,
            kind: 'voice',
            voice_path: 'c1/u2/take.m4a',
            voice_duration_ms: 42_000,
            created_at: '2026-11-02T21:04:00Z',
            reactions: [],
          },
        ],
      },
      error: null,
    });
    const q = await getRevealedQuestion('cq-1');
    expect(q.answers[0]).toMatchObject({
      body: 'Voice note',
      voice: { path: 'c1/u2/take.m4a', durationMs: 42_000 },
    });
  });
});

describe('saveAnswer', () => {
  it('upserts my row with client_written_at on couple_question_id,user_id', async () => {
    mockWrite.mockResolvedValue({ data: null, error: null });
    await saveAnswer({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: 'Your laugh.',
      clientWrittenAt: '2026-11-02T20:51:00.000Z',
    });
    expect(mockWrite).toHaveBeenCalledWith(
      'answers',
      'upsert',
      {
        couple_question_id: 'cq-1',
        user_id: 'u1',
        body: 'Your laugh.',
        client_written_at: '2026-11-02T20:51:00.000Z',
        // D46: a text save always clears the voice fields (text XOR voice).
        kind: 'text',
        voice_path: null,
        voice_duration_ms: null,
      },
      { onConflict: 'couple_question_id,user_id' },
    );
  });

  it('a voice answer (D46) sends kind voice, body null, the object and its length', async () => {
    mockWrite.mockResolvedValue({ data: null, error: null });
    await saveAnswer({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: 'ignored',
      voice: { path: 'c1/u1/take.m4a', durationMs: 41_999.6 },
      clientWrittenAt: '2026-11-02T20:51:00.000Z',
    });
    expect(mockWrite).toHaveBeenCalledWith(
      'answers',
      'upsert',
      {
        couple_question_id: 'cq-1',
        user_id: 'u1',
        client_written_at: '2026-11-02T20:51:00.000Z',
        kind: 'voice',
        body: null,
        voice_path: 'c1/u1/take.m4a',
        voice_duration_ms: 42_000,
      },
      { onConflict: 'couple_question_id,user_id' },
    );
  });

  it('turns a failure into an AppError without the answer text', async () => {
    mockWrite.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'violates check', details: 'Failing row contains (secret)' },
    });
    const error = await saveAnswer({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: 'secret',
      clientWrittenAt: '2026-11-02T20:51:00.000Z',
    }).catch((e: Error) => e);
    expect(error).toMatchObject({ kind: 'UNKNOWN' });
    expect((error as Error).message).not.toContain('secret');
  });
});

describe('answer reactions (D45)', () => {
  it('upserts one reaction per person per answer', async () => {
    mockWrite.mockResolvedValue({ data: null, error: null });
    await setAnswerReaction({ answerId: 'a2', userId: 'u1', kind: '🔥' });
    expect(mockWrite).toHaveBeenCalledWith(
      'reactions',
      'upsert',
      { answer_id: 'a2', user_id: 'u1', kind: '🔥' },
      { onConflict: 'answer_id,user_id' },
    );
  });

  it('removes only my own reaction', async () => {
    mockWrite.mockResolvedValue({ data: null, error: null });
    await removeAnswerReaction({ answerId: 'a2', userId: 'u1' });
    expect(mockWrite).toHaveBeenCalledWith('reactions', 'delete', {
      answer_id: 'a2',
      user_id: 'u1',
    });
  });
});
