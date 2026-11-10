import { sendFeedback } from '@/features/feedback/api';

const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn((_table: string) => ({
  insert: (row: unknown) => {
    mockInsert(row);
    const done = Promise.resolve(mockResult);
    return Object.assign(done, { select: mockSelect });
  },
}));
let mockResult: { data: unknown; error: unknown } = { data: null, error: null };
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));
jest.mock('expo-constants', () => ({ expoConfig: { version: '0.1.0' } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockResult = { data: null, error: null };
});

describe('sendFeedback (CONTRACTS §2 Feedback, BE-15)', () => {
  it('inserts my row with the app version and never reads it back (return=minimal)', async () => {
    await sendFeedback({
      userId: 'u1',
      kind: 'feedback',
      score: null,
      tags: ['partner_forgets'],
      body: 'note',
    });
    expect(mockFrom).toHaveBeenCalledWith('feedback');
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'u1',
      kind: 'feedback',
      score: null,
      tags: ['partner_forgets'],
      body: 'note',
      app_version: '0.1.0',
    });
    // RLS has no select policy: asking for the row back would fail the insert.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('sends a check-in score with no tags and an empty body', async () => {
    await sendFeedback({ userId: 'u1', kind: 'check_in', score: 4, tags: [], body: '' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'check_in', score: 4, tags: [], body: '' }),
    );
  });

  it('a failure is an AppError', async () => {
    mockResult = { data: null, error: { message: 'Network request failed' } };
    await expect(
      sendFeedback({ userId: 'u1', kind: 'feedback', score: null, tags: [], body: 'x' }),
    ).rejects.toMatchObject({ kind: 'NETWORK' });
  });
});
