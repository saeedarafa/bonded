import { getThread, getUnreadCount, markThreadRead, sendMessage } from '@/features/thread/api';

const mockInsert = jest.fn<Promise<unknown>, [string, unknown]>();
const mockUpsert = jest.fn<Promise<unknown>, [string, unknown, unknown]>();
const mockCalls: [string, ...unknown[]][] = [];
let mockResult: unknown = { data: [], error: null };
let mockMarker: unknown = { data: null, error: null };

// A chainable query: records every filter, resolves to `mockResult`.
function mockQuery(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'gt', 'order']) {
    q[m] = (...args: unknown[]) => {
      mockCalls.push([`${table}.${m}`, ...args]);
      return q;
    };
  }
  q.maybeSingle = () => Promise.resolve(mockMarker);
  q.then = (resolve: (v: unknown) => unknown) => resolve(mockResult);
  return q;
}
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      ...mockQuery(table),
      insert: (row: unknown) => mockInsert(table, row),
      upsert: (row: unknown, options: unknown) => mockUpsert(table, row, options),
    }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockResult = { data: [], error: null };
  mockMarker = { data: null, error: null };
});

const input = { clientId: 'c-1', coupleQuestionId: 'cq-1', userId: 'u1', body: 'Deal.' };

describe('sendMessage', () => {
  it('inserts with the device client_id', async () => {
    mockInsert.mockResolvedValue({ error: null });
    await sendMessage(input);
    expect(mockInsert).toHaveBeenCalledWith('thread_messages', {
      client_id: 'c-1',
      couple_question_id: 'cq-1',
      user_id: 'u1',
      body: 'Deal.',
    });
  });

  it('treats a duplicate client_id as already sent (a retry never doubles a message)', async () => {
    mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } });
    await expect(sendMessage(input)).resolves.toBeUndefined();
  });

  it('fails other errors without copying the text into the message', async () => {
    mockInsert.mockResolvedValue({
      error: { code: '23514', message: 'check violation', details: 'Failing row (Deal.)' },
    });
    const error = await sendMessage(input).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('Deal.');
  });
});

describe('getThread', () => {
  it('reads one question in order and maps the rows', async () => {
    mockResult = {
      data: [
        {
          id: 'm1',
          client_id: 'c-1',
          user_id: 'u2',
          body: 'Hi',
          created_at: '2026-11-02T21:00:00Z',
          reactions: [{ id: 'r1', user_id: 'u1', kind: 'love' }],
        },
      ],
      error: null,
    };
    await expect(getThread('cq-1')).resolves.toEqual([
      {
        id: 'm1',
        clientId: 'c-1',
        userId: 'u2',
        body: 'Hi',
        createdAt: '2026-11-02T21:00:00Z',
        reactions: [{ id: 'r1', userId: 'u1', kind: 'love' }],
      },
    ]);
    expect(mockCalls).toContainEqual(['thread_messages.eq', 'couple_question_id', 'cq-1']);
    expect(mockCalls).toContainEqual(['thread_messages.order', 'created_at']);
  });
});

describe('read markers', () => {
  it('upserts my marker', async () => {
    mockUpsert.mockResolvedValue({ data: null, error: null });
    await markThreadRead({ coupleQuestionId: 'cq-1', userId: 'u1', lastReadAt: 't' });
    expect(mockUpsert).toHaveBeenCalledWith(
      'thread_reads',
      { couple_question_id: 'cq-1', user_id: 'u1', last_read_at: 't' },
      { onConflict: 'couple_question_id,user_id' },
    );
  });

  it("counts the partner's messages after my marker, selecting no text", async () => {
    mockMarker = { data: { last_read_at: '2026-11-02T21:00:00Z' }, error: null };
    mockResult = { count: 2, error: null };
    await expect(getUnreadCount('cq-1', 'u1')).resolves.toBe(2);
    expect(mockCalls).toContainEqual([
      'thread_messages.select',
      'id',
      { count: 'exact', head: true },
    ]);
    expect(mockCalls).toContainEqual(['thread_messages.neq', 'user_id', 'u1']);
    expect(mockCalls).toContainEqual(['thread_messages.gt', 'created_at', '2026-11-02T21:00:00Z']);
  });

  it('counts every partner message without a marker', async () => {
    mockResult = { count: 3, error: null };
    await expect(getUnreadCount('cq-1', 'u1')).resolves.toBe(3);
    expect(mockCalls.some(([c]) => c === 'thread_messages.gt')).toBe(false);
  });
});
