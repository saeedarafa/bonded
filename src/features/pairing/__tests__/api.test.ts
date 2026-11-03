import {
  acceptInvite,
  createInvite,
  inviteLink as requestInviteLink,
  invitePreview,
} from '@/features/pairing/api';
import {
  currentInvite,
  displayCode,
  inviteLink,
  inviteStatus,
  spokenCode,
} from '@/features/pairing/invite';
import { shareInviteMessage } from '@/features/pairing/share';

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

describe('invite_link (BE-28, D36)', () => {
  it('returns the same code with a new token, no args', async () => {
    mockRpc.mockResolvedValue({
      data: { code: '4827', expires_at: '2026-11-04T10:00:00Z', token: 'new' },
      error: null,
    });
    await expect(requestInviteLink()).resolves.toEqual({
      code: '4827',
      expiresAt: '2026-11-04T10:00:00Z',
      token: 'new',
    });
    expect(mockRpc).toHaveBeenCalledWith('invite_link', undefined);
  });

  it.each([
    ['null', null],
    [
      'an all-null composite (PostgREST, no open invite)',
      { code: null, expires_at: null, token: null },
    ],
    ['an empty array', []],
  ])('no open invite: %s -> null', async (_label, data) => {
    mockRpc.mockResolvedValue({ data, error: null });
    await expect(requestInviteLink()).resolves.toBeNull();
  });

  it('an RPC not deployed yet (PGRST202) -> null, so the code is shared alone', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.invite_link', code: 'PGRST202' },
    });
    await expect(requestInviteLink()).resolves.toBeNull();
  });

  it.each(['RATE_LIMITED', 'NOT_AUTHENTICATED'] as const)('raises %s', async (kind) => {
    mockRpc.mockResolvedValue(body(kind));
    await expect(requestInviteLink()).rejects.toMatchObject({ kind });
  });
});

describe('which code to show (D36)', () => {
  const NOW = Date.parse('2026-11-03T12:00:00Z');
  const LATER = '2026-11-04T12:00:00Z';
  const EARLIER = '2026-11-02T12:00:00Z';
  const open = { code: '5150', expiresAt: LATER, acceptedAt: null };

  it('after a restart (nothing in memory) shows the open code without a token', () => {
    expect(currentInvite(null, open, NOW)).toEqual({ code: '5150', expiresAt: LATER, token: null });
    expect(inviteStatus(currentInvite(null, open, NOW), open, NOW)).toBe('open');
  });

  it('adds the in-memory token only when it is for the same code', () => {
    const stored = { code: '5150', expiresAt: LATER, token: 'tok' };
    expect(currentInvite(stored, open, NOW)?.token).toBe('tok');
    expect(currentInvite({ ...stored, code: '1111' }, open, NOW)).toEqual({
      code: '5150',
      expiresAt: LATER,
      token: null,
    });
  });

  it('before the open invite loads, uses a fresh in-memory invite', () => {
    const stored = { code: '5150', expiresAt: LATER, token: 'tok' };
    expect(currentInvite(stored, undefined, NOW)).toEqual(stored);
    expect(inviteStatus(null, undefined, NOW)).toBe('loading');
  });

  it('expired, used or none: nothing to show', () => {
    const expired = { ...open, expiresAt: EARLIER };
    expect(currentInvite(null, expired, NOW)).toBeNull();
    expect(inviteStatus(null, expired, NOW)).toBe('expired');
    const used = { ...open, acceptedAt: EARLIER };
    expect(currentInvite(null, used, NOW)).toBeNull();
    expect(inviteStatus(null, used, NOW)).toBe('none');
    expect(inviteStatus(null, null, NOW)).toBe('none');
  });
});

describe('share message', () => {
  it('includes the link only with a token', () => {
    expect(shareInviteMessage('4827', 'tok', 'alex')).toContain('bonded://j/BND4827?t=tok');
    const codeOnly = shareInviteMessage('4827', null, 'alex');
    expect(codeOnly).toContain('Alex saved you a seat');
    expect(codeOnly).toContain('join with code BND·4827');
    expect(codeOnly).not.toContain('t=');
    expect(shareInviteMessage('4827', null, '  ')).toMatch(/^I saved you a seat/);
  });
});
