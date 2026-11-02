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
