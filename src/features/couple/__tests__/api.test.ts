import { getActiveCouple, unpair } from '@/features/couple/api';
import { AppError } from '@/lib/errors';

const mockRpc = jest.fn<Promise<unknown>, [string]>();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn((_column: string, _value: string) => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn((_columns: string) => ({ eq: mockEq }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string) => mockRpc(name),
    from: (table: string) => mockFrom(table),
  },
}));

beforeEach(() => jest.clearAllMocks());

describe('unpair', () => {
  it('succeeds', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(unpair()).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('unpair');
  });

  it('treats NOT_PAIRED on a retry as success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'NOT_PAIRED', code: 'P0001' } });
    await expect(unpair()).resolves.toBeUndefined();
  });

  it('still fails on anything else, as an AppError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });
    await expect(unpair()).rejects.toMatchObject({ kind: 'SIGNED_OUT' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await expect(unpair()).rejects.toBeInstanceOf(AppError);
  });
});

describe('getActiveCouple', () => {
  it('asks for my active couple with its members', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getActiveCouple()).resolves.toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('couples');
    expect(mockSelect).toHaveBeenCalledWith('*, couple_members(user_id, left_at)');
    expect(mockEq).toHaveBeenCalledWith('status', 'active');
  });

  it('maps errors', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'NOT_AUTHENTICATED' } });
    await expect(getActiveCouple()).rejects.toMatchObject({ kind: 'NOT_AUTHENTICATED' });
  });
});
