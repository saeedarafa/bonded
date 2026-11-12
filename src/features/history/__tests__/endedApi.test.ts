import {
  getEndedHistoryPage,
  getEndedQuestion,
  getHistoryDetail,
  getHistoryExport,
  getHistoryPage,
  PARTNER_ANSWERED,
} from '@/features/history/api';

// A chainable query builder: every filter returns itself; the awaited end returns the next result.
type Result = { data: unknown; error: unknown };
let mockResult: Result = { data: null, error: null };
// When set, each awaited query or rpc takes the next result (paged reads).
let mockResults: Result[] = [];
const mockCalls: [string, unknown[]][] = [];
const next = () => Promise.resolve(mockResults.length ? mockResults.shift()! : mockResult);
function mockBuilder(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'gt', 'in', 'order', 'range']) {
    b[name] = (...args: unknown[]) => {
      mockCalls.push([name, args]);
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => unknown) => next().then(resolve);
  return b;
}
const mockFrom = jest.fn((_table: string) => mockBuilder());
const mockRpc = jest.fn((name: string, args: unknown) => {
  mockCalls.push(['rpc', [name, args]]);
  return next();
});
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  },
}));

/** One `history_days` row (BE-55): never any answer or message text. */
const day = (over: Record<string, unknown> = {}) => ({
  couple_question_id: 'cq-1',
  couple_id: 'couple-old',
  question_id: 'q-1',
  question: { id: 'q-1', body: 'What made you smile?' },
  source: 'daily',
  day: '2026-10-20',
  created_at: '2026-10-20T00:05:00Z',
  my_answered: true,
  partner_answered: true,
  message_count: 3,
  locked: false,
  ...over,
});
const ROW = {
  id: 'cq-1',
  source: 'daily',
  assignedFor: '2026-10-20',
  createdAt: '2026-10-20T00:05:00Z',
  question: 'What made you smile?',
  answeredBy: ['u1', PARTNER_ANSWERED],
  replies: 3,
  locked: false,
};

beforeEach(() => {
  mockCalls.length = 0;
  mockFrom.mockClear();
  mockRpc.mockClear();
  mockResult = { data: null, error: null };
  mockResults = [];
});

describe('History list and detail on history_days (MOB-71, D55)', () => {
  it('lists every day of a page; hearts are read only for open answered days', async () => {
    mockResults = [
      {
        data: [
          day({ couple_question_id: 'cq-new' }),
          day({ couple_question_id: 'cq-old', locked: true, message_count: 4 }),
          day({ couple_question_id: 'cq-none', my_answered: false, partner_answered: false }),
          day({ couple_question_id: 'cq-pack', source: 'pack', partner_answered: false }),
        ],
        error: null,
      },
      {
        data: [{ id: 'cq-new', answers: [{ reactions: [{ count: 2 }] }, { reactions: [] }] }],
        error: null,
      },
    ];
    const rows = await getHistoryPage('couple-1', 2);
    expect(mockRpc).toHaveBeenCalledWith('history_days', {
      p_couple_id: 'couple-1',
      p_limit: 20,
      p_offset: 40,
    });
    // The second read never names a locked day, and selects no text.
    expect(mockCalls).toContainEqual(['in', ['id', ['cq-new', 'cq-pack']]]);
    const select = mockCalls.find(([n]) => n === 'select')?.[1][0] as string;
    expect(select).not.toMatch(/body/);
    expect(
      rows.map((r) => [r.id, r.answerCount, r.hearts, r.replies, r.locked, r.assignedFor]),
    ).toEqual([
      ['cq-new', 2, 2, 3, false, '2026-10-20'],
      ['cq-old', 2, 0, 4, true, '2026-10-20'],
      ['cq-none', 0, 0, 3, false, '2026-10-20'],
      ['cq-pack', 1, 0, 3, false, null],
    ]);
    expect(rows[0]?.question).toBe('What made you smile?');
  });

  it('a page of only locked days reads nothing else', async () => {
    mockResults = [{ data: [day({ locked: true })], error: null }];
    await getHistoryPage('couple-1', 0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('a day by id: locked, who answered as my id and the partner stand-in', async () => {
    mockResults = [{ data: [day({ locked: true, my_answered: false })], error: null }];
    await expect(getHistoryDetail('cq-1', 'u1')).resolves.toEqual({
      id: 'cq-1',
      questionId: 'q-1',
      source: 'daily',
      assignedFor: '2026-10-20',
      createdAt: '2026-10-20T00:05:00Z',
      answerCount: 1,
      question: 'What made you smile?',
      answeredBy: [PARTNER_ANSWERED],
      replies: 3,
      locked: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('history_days', { p_couple_question_id: 'cq-1' });
    mockResults = [{ data: [], error: null }];
    await expect(getHistoryDetail('nope', 'u1')).resolves.toBeNull();
  });
});

describe('ended couple History api (MOB-50, MOB-71)', () => {
  it('reads a page of the ended couple, newest first, without answer text', async () => {
    mockResult = { data: [day()], error: null };
    await expect(getEndedHistoryPage('couple-old', 1, 'u1')).resolves.toEqual([ROW]);
    expect(mockRpc).toHaveBeenCalledWith('history_days', {
      p_couple_id: 'couple-old',
      p_limit: 20,
      p_offset: 20,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('a locked day stays listed, locked (D55: no Premium of my own)', async () => {
    mockResult = { data: [day({ locked: true, partner_answered: false })], error: null };
    await expect(getEndedHistoryPage('couple-old', 0, 'u1')).resolves.toEqual([
      { ...ROW, answeredBy: ['u1'], locked: true },
    ]);
  });

  it('opens one question only within the ended couple', async () => {
    mockResult = { data: [day()], error: null };
    await expect(getEndedQuestion('couple-old', 'cq-1', 'u1')).resolves.toEqual(ROW);
    expect(mockRpc).toHaveBeenCalledWith('history_days', { p_couple_question_id: 'cq-1' });
    mockResult = { data: [day({ couple_id: 'couple-other' })], error: null };
    await expect(getEndedQuestion('couple-old', 'cq-1', 'u1')).resolves.toBeNull();
    mockResult = { data: [], error: null };
    await expect(getEndedQuestion('couple-old', 'nope', 'u1')).resolves.toBeNull();
  });
});

describe('History PDF export api (MOB-27, MOB-71)', () => {
  const raw = (i: number) => ({
    id: `cq-${i}`,
    source: 'daily',
    assigned_for: '2026-10-20',
    created_at: '2026-10-20T00:05:00Z',
    question: { body: 'Q' },
    answers: [{ user_id: 'u1', body: 'FIXTURE-a', created_at: '2026-10-20T09:00:00Z' }],
    thread_messages: [{ user_id: 'u2', body: 'FIXTURE-m', created_at: '2026-10-20T10:00:00Z' }],
  });

  it('lists the days 100 at a time, reads text only for open days I answered', async () => {
    const open = Array.from({ length: 99 }, (_, i) => day({ couple_question_id: `cq-${i}` }));
    mockResults = [
      { data: [...open, day({ couple_question_id: 'cq-locked', locked: true })], error: null },
      {
        data: [
          day({ couple_question_id: 'cq-100' }),
          day({ couple_question_id: 'cq-theirs', my_answered: false }),
          day({ couple_question_id: 'cq-locked-theirs', locked: true, my_answered: false }),
        ],
        error: null,
      },
      {
        data: [...Array.from({ length: 99 }, (_, i) => raw(i)), raw(100)],
        error: null,
      },
    ];
    const rows = await getHistoryExport('couple-old');
    expect(mockCalls.filter(([n]) => n === 'rpc').map(([, a]) => a)).toEqual([
      ['history_days', { p_couple_id: 'couple-old', p_limit: 100, p_offset: 0 }],
      ['history_days', { p_couple_id: 'couple-old', p_limit: 100, p_offset: 100 }],
    ]);
    const ids = mockCalls.find(([n]) => n === 'in')?.[1][1] as string[];
    expect(ids).toHaveLength(100);
    expect(ids).not.toContain('cq-locked');
    expect(ids).not.toContain('cq-theirs');
    expect(mockCalls).toContainEqual(['eq', ['couple_id', 'couple-old']]);
    // One locked day I answered: listed without any text, so the PDF can say it was left out.
    expect(rows.filter((r) => r.locked)).toEqual([
      {
        id: 'cq-locked',
        source: 'daily',
        assignedFor: '2026-10-20',
        createdAt: '2026-10-20T00:05:00Z',
        question: 'What made you smile?',
        answers: [],
        messages: [],
        locked: true,
      },
    ]);
    expect(rows.find((r) => r.id === 'cq-100')).toEqual({
      id: 'cq-100',
      source: 'daily',
      assignedFor: '2026-10-20',
      createdAt: '2026-10-20T00:05:00Z',
      question: 'Q',
      answers: [{ userId: 'u1', body: 'FIXTURE-a', createdAt: '2026-10-20T09:00:00Z' }],
      messages: [{ userId: 'u2', body: 'FIXTURE-m', createdAt: '2026-10-20T10:00:00Z' }],
    });
  });

  it('everything locked: no text is read at all', async () => {
    mockResults = [{ data: [day({ locked: true })], error: null }];
    const rows = await getHistoryExport('couple-old');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('an error stops the export (no half PDF)', async () => {
    mockResult = { data: null, error: { message: 'Failed to fetch' } };
    await expect(getHistoryExport('couple-old')).rejects.toThrow();
  });
});
