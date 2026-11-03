import { inviteDomain } from '@/lib/env';

/** `BND·4827` (D01), the way the code is shown and spoken. */
export function displayCode(digits: string): string {
  return `BND·${digits}`;
}

/** Screen-reader form: "B N D, 4 8 2 7". */
export function spokenCode(digits: string): string {
  return `B N D, ${digits.split('').join(' ')}`;
}

/**
 * The link to share (D02, D07): `https://<domain>/j/BND4827?t=<token>`. Until the real domain is
 * configured the app's own scheme is used, which only works on a phone that has Bonded installed.
 */
export function inviteLink(digits: string, token: string): string {
  const query = `t=${encodeURIComponent(token)}`;
  const domain = inviteDomain();
  return domain ? `https://${domain}/j/BND${digits}?${query}` : `bonded://j/BND${digits}?${query}`;
}

/** The invite to show: the code always, the token only when this session has one in memory. */
export type ShownInvite = { code: string; expiresAt: string; token: string | null };

type InviteLike = { code: string; expiresAt: string };

export function isFresh(expiresAt: string | null | undefined, now = Date.now()): boolean {
  return !!expiresAt && Date.parse(expiresAt) > now;
}

/**
 * D36: which code the inviter sees. The open invite in `pair_invites` is the truth (it survives a
 * restart); the in-memory one adds its token when it is the same code. Before the open invite has
 * loaded, a fresh in-memory invite is shown as is.
 *
 * - `open` undefined: not loaded yet. `null`: there is none.
 * - Returns null when there is no usable code (none, expired or already used).
 */
export function currentInvite(
  stored: (InviteLike & { token: string }) | null,
  open: (InviteLike & { acceptedAt?: string | null }) | null | undefined,
  now = Date.now(),
): ShownInvite | null {
  const storedFresh = stored && isFresh(stored.expiresAt, now) ? stored : null;
  if (open === undefined) return storedFresh;
  if (!open || open.acceptedAt || !isFresh(open.expiresAt, now)) return null;
  const token = storedFresh?.code === open.code ? storedFresh.token : null;
  return { code: open.code, expiresAt: open.expiresAt, token };
}

/** What the open invite looks like to the solo Today card. */
export type InviteStatus = 'loading' | 'open' | 'expired' | 'none';

export function inviteStatus(
  shown: ShownInvite | null,
  open: (InviteLike & { acceptedAt?: string | null }) | null | undefined,
  now = Date.now(),
): InviteStatus {
  if (shown) return 'open';
  if (open === undefined) return 'loading';
  if (open && !open.acceptedAt && !isFresh(open.expiresAt, now)) return 'expired';
  return 'none';
}
