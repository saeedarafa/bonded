import { getPack, getPacks, startPackQuestion } from '@/features/packs/api';

const mockRpc = jest.fn<Promise<unknown>, [string, unknown]>();
const mockOrder = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn((_c: string, _v: string) => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn((_columns: string) => ({ order: mockOrder, eq: mockEq }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
  },
}));

beforeEach(() => jest.clearAllMocks());

const ROW = {
  id: 'p-1',
  slug: 'future-us',
  title: 'Future Us',
  description: 'd',
  is_premium: true,
  icon: 'future-us',
  age_gate: null,
};

describe('getPacks', () => {
  it('reads packs in order with a question count and skips an 18+ pack (D33)', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { ...ROW, pack_questions: [{ count: 12 }] },
        { ...ROW, id: 'p-2', slug: 'spicy', age_gate: '18+', pack_questions: [{ count: 9 }] },
      ],
      error: null,
    });
    const packs = await getPacks();
    expect(mockFrom).toHaveBeenCalledWith('question_packs');
    expect(mockSelect.mock.calls[0]?.[0]).toContain('pack_questions(count)');
    // No question text in the library.
    expect(mockSelect.mock.calls[0]?.[0]).not.toContain('body');
    expect(mockOrder).toHaveBeenCalledWith('sort_order');
    expect(packs).toEqual([
      {
        id: 'p-1',
        slug: 'future-us',
        title: 'Future Us',
        description: 'd',
        isPremium: true,
        icon: 'future-us',
        questionCount: 12,
      },
    ]);
  });

  it('turns an error into an AppError', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await expect(getPacks()).rejects.toMatchObject({ kind: 'NETWORK' });
  });
});

describe('getPack', () => {
  it('sorts questions by position and drops ones RLS hid', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        ...ROW,
        pack_questions: [
          { position: 2, question: { id: 'q2', body: 'B' } },
          { position: 3, question: null },
          { position: 1, question: { id: 'q1', body: 'A' } },
        ],
      },
      error: null,
    });
    const pack = await getPack('p-1');
    expect(mockEq).toHaveBeenCalledWith('id', 'p-1');
    expect(pack?.questions).toEqual([
      { id: 'q1', position: 1, body: 'A' },
      { id: 'q2', position: 2, body: 'B' },
    ]);
  });

  it('null for an unknown, inactive or 18+ pack', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getPack('nope')).resolves.toBeNull();
    mockMaybeSingle.mockResolvedValue({
      data: { ...ROW, age_gate: '18+', pack_questions: [] },
      error: null,
    });
    await expect(getPack('p-2')).resolves.toBeNull();
  });
});

describe('startPackQuestion', () => {
  it('calls the RPC and returns the couple_questions id', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'cq-9' }, error: null });
    await expect(startPackQuestion('q1')).resolves.toBe('cq-9');
    expect(mockRpc).toHaveBeenCalledWith('start_pack_question', { p_question: 'q1' });
  });

  it('PREMIUM_REQUIRED from the server is an AppError of that kind', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'PREMIUM_REQUIRED', code: 'P0001' },
    });
    await expect(startPackQuestion('q2')).rejects.toMatchObject({ kind: 'PREMIUM_REQUIRED' });
  });
});
