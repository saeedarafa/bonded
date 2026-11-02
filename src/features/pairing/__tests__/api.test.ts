import { acceptInvite, createInvite, invitePreview } from '@/features/pairing/api';
import { displayCode, inviteLink, spokenCode } from '@/features/pairing/invite';

const mockRpc = jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => mockRpc(name, args) },
}));

beforeEach(() => jest.clearAllMocks());

const body = (message: string) => ({ data: null, error: { message, code: 'P0001' } });

describe('create_invite', () => {
  it('maps the {code, expires_at, token} object', async () => {
    mockRpc.mockResolvedValue({
      data: { code: '4827', expires_at: '2026-11-04T10:00:00Z', token: 'abc' },
      error: null,
    });
    await expect(createInvite()).resolves.toEqual({
      code: '4827',
      expiresAt: '2026-11-04T10:00:00Z',
      token: 'abc',
    });
  });

  it('surfaces NOT_PAIRED (no couple yet) as an AppError kind', async () => {
    mockRpc.mockResolvedValue(body('NOT_PAIRED'));
    await expect(createInvite()).rejects.toMatchObject({ kind: 'NOT_PAIRED' });
  });
});

describe('invite_preview', () => {
  it('sends the token only when there is one and keeps just the four fields', async () => {
    mockRpc.mockResolvedValue({
      data: {
        inviter_name: 'Maya',
        inviter_avatar_url: null,
        inviter_answered_today: true,
        expires_at: '2026-11-04T10:00:00Z',
      },
      error: null,
    });
    await expect(invitePreview('4827', null)).resolves.toEqual({
      inviterName: 'Maya',
      inviterAvatarUrl: null,
      inviterAnsweredToday: true,
      expiresAt: '2026-11-04T10:00:00Z',
    });
    expect(mockRpc).toHaveBeenLastCalledWith('invite_preview', { p_code: '4827' });
    mockRpc.mockResolvedValue({ data: { inviter_name: 'Maya' }, error: null });
    await invitePreview('4827', 'tok');
    expect(mockRpc).toHaveBeenLastCalledWith('invite_preview', { p_code: '4827', p_token: 'tok' });
  });

  it.each(['INVALID_CODE', 'INVITE_EXPIRED', 'COUPLE_FULL', 'RATE_LIMITED'] as const)(
    'maps the %s error body',
    async (kind) => {
      mockRpc.mockResolvedValue(body(kind));
      await expect(invitePreview('4827', null)).rejects.toMatchObject({ kind });
    },
  );

  it('rejects a body without an inviter as a generic error', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    await expect(invitePreview('4827', null)).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });
});

describe('accept_invite', () => {
  it('returns the couple id', async () => {
    mockRpc.mockResolvedValue({ data: 'couple-9', error: null });
    await expect(acceptInvite('4827', 'tok')).resolves.toBe('couple-9');
    expect(mockRpc).toHaveBeenCalledWith('accept_invite', { p_code: '4827', p_token: 'tok' });
  });

  it('treats ALREADY_PAIRED on a retry as done', async () => {
    mockRpc.mockResolvedValue(body('ALREADY_PAIRED'));
    await expect(acceptInvite('4827', null)).resolves.toBeNull();
  });

  it.each(['INVALID_CODE', 'INVITE_EXPIRED', 'COUPLE_FULL', 'OWN_CODE', 'RATE_LIMITED'] as const)(
    'fails with %s',
    async (kind) => {
      mockRpc.mockResolvedValue(body(kind));
      await expect(acceptInvite('4827', null)).rejects.toMatchObject({ kind });
    },
  );
});

describe('invite formatting', () => {
  it('shows BND·4827 and speaks the digits', () => {
    expect(displayCode('4827')).toBe('BND·4827');
    expect(spokenCode('4827')).toBe('B N D, 4 8 2 7');
  });

  it('builds the link with the token (no domain configured in tests: app scheme)', () => {
    expect(inviteLink('4827', 'a-b_c')).toBe('bonded://j/BND4827?t=a-b_c');
  });
});
