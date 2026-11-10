import { getEndedHistoryPage, getEndedQuestion, getHistoryExport } from '@/features/history/api';

// A chainable query builder: every filter returns itself; the awaited end returns `mockResult`.
let mockResult: { data: unknown; error: unknown } = { data: null, error: null };
// When set, each awaited query takes the next result (paged reads).
let mockResults: { data: unknown; error: unknown }[] = [];
const mockCalls: [string, unknown[]][] = [];
function mockBuilder(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'gt', 'order', 'range']) {
    b[name] = (...args: unknown[]) => {
      mockCalls.push([name, args]);
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(mockResult);
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(mockResults.length ? mockResults.shift() : mockResult).then(resolve);
  return b;
}
const mockFrom = jest.fn((_table: string) => mockBuilder());
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

const RAW = {
  id: 'cq-1',
  source: 'daily',
  assigned_for: '2026-10-20',
  created_at: '2026-10-20T00:05:00Z',
  question: { body: 'What made you smile?' },
  answers: [{ user_id: 'u1' }, { user_id: 'u2' }],
  thread_messages: [{ count: 3 }],
};
const ROW = {
  id: 'cq-1',
  source: 'daily',
  assignedFor: '2026-10-20',
  createdAt: '2026-10-20T00:05:00Z',
  question: 'What made you smile?',
  answeredBy: ['u1', 'u2'],
  replies: 3,
};

beforeEach(() => {
  mockCalls.length = 0;
  mockResult = { data: null, error: null };
  mockResults = [];
});

describe('ended couple History api (MOB-50)', () => {
  it('reads a page of the ended couple, newest first, without answer text', async () => {
    mockResult = { data: [RAW], error: null };
    await expect(getEndedHistoryPage('couple-old', 1)).resolves.toEqual([ROW]);
    expect(mockFrom).toHaveBeenCalledWith('couple_questions');
    const select = mockCalls.find(([n]) => n === 'select')?.[1][0] as string;
    expect(select).not.toMatch(/body,|answers\([^)]*body/);
    expect(mockCalls).toContainEqual(['eq', ['couple_id', 'couple-old']]);
    expect(mockCalls).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(mockCalls).toContainEqual(['range', [20, 39]]);
  });

  it('opens one question only within the ended couple', async () => {
    mockResult = { data: RAW, error: null };
    await expect(getEndedQuestion('couple-old', 'cq-1')).resolves.toEqual(ROW);
    expect(mockCalls).toContainEqual(['eq', ['couple_id', 'couple-old']]);
    expect(mockCalls).toContainEqual(['eq', ['id', 'cq-1']]);
    mockResult = { data: null, error: null };
    await expect(getEndedQuestion('couple-old', 'nope')).resolves.toBeNull();
  });
});

describe('History PDF export api (MOB-27)', () => {
  const raw = (i: number) => ({
    id: `cq-${i}`,
    source: 'daily',
    assigned_for: '2026-10-20',
    created_at: '2026-10-20T00:05:00Z',
    question: { body: 'Q' },
    answers: [{ user_id: 'u1', body: 'FIXTURE-a', created_at: '2026-10-20T09:00:00Z' }],
    thread_messages: [{ user_id: 'u2', body: 'FIXTURE-m', created_at: '2026-10-20T10:00:00Z' }],
  });

  it('reads the whole ended couple 100 at a time, oldest first, with text', async () => {
    mockResults = [
      { data: Array.from({ length: 100 }, (_, i) => raw(i)), error: null },
      { data: [raw(100)], error: null },
    ];
    const rows = await getHistoryExport('couple-old');
    expect(rows).toHaveLength(101);
    expect(rows[100]).toEqual({
      id: 'cq-100',
      source: 'daily',
      assignedFor: '2026-10-20',
      createdAt: '2026-10-20T00:05:00Z',
      question: 'Q',
      answers: [{ userId: 'u1', body: 'FIXTURE-a', createdAt: '2026-10-20T09:00:00Z' }],
      messages: [{ userId: 'u2', body: 'FIXTURE-m', createdAt: '2026-10-20T10:00:00Z' }],
    });
    expect(mockCalls).toContainEqual(['eq', ['couple_id', 'couple-old']]);
    expect(mockCalls).toContainEqual(['gt', ['answer_count', 0]]);
    expect(mockCalls).toContainEqual(['order', ['created_at', { ascending: true }]]);
    expect(mockCalls.filter(([n]) => n === 'range').map(([, a]) => a)).toEqual([
      [0, 99],
      [100, 199],
    ]);
  });

  it('an error stops the export (no half PDF)', async () => {
    mockResult = { data: null, error: { message: 'Failed to fetch' } };
    await expect(getHistoryExport('couple-old')).rejects.toThrow();
  });
});
