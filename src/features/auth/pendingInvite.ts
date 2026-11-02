import { create } from 'zustand';

/** The code is `BND` + 4 digits (D01). */
const CODE_DIGITS = 4;

/**
 * Invite links (MOB-08, D02, D07): `https://<domain>/j/BND4827?t=<token>` and
 * `bonded://j/BND4827?t=<token>`. Both open the app on `app/j/[code].tsx`.
 */
export type InviteLink = { code: string | null; token: string | null };

/** The four digits from `BND4827`, `bnd·4827`, `4827`; null when there aren't exactly four. */
export function parseInviteCode(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/^\s*bnd/i, '').replace(/[\s·\-.]/g, '');
  return new RegExp(`^\\d{${CODE_DIGITS}}$`).test(digits) ? digits : null;
}

/** url-safe base64 characters only (the 192-bit token); anything else is dropped. */
export function parseInviteToken(raw: string | string[] | null | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : null;
}

type PendingInviteState = {
  code: string | null;
  token: string | null;
  /** First name from `invite_preview`, for "Maya already set up the rest" (J4). Set by MOB-09. */
  inviterName: string | null;
  set: (invite: Partial<Pick<PendingInviteState, 'code' | 'token' | 'inviterName'>>) => void;
  clear: () => void;
};

/**
 * The invite the person arrived with, kept in memory across sign-in (Apple, Google and the email
 * code all happen inside the app). MOB-09 reads it to call `accept_invite(code, token)`.
 * The token is never written to disk, logs or analytics.
 */
export const usePendingInvite = create<PendingInviteState>((set) => ({
  code: null,
  token: null,
  inviterName: null,
  set: (invite) => set(invite),
  clear: () => set({ code: null, token: null, inviterName: null }),
}));
