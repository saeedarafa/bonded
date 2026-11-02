// QA-03: contract rows that later backend tasks add or change (BE-04, BE-05). Each todo becomes
// a real test in rpc.test.ts / tables.test.ts when its task lands on main (BACKLOG, DESIGN_DELTA
// ids). BE-03 and BE-24 are live and no longer here.
// Expected behaviour comes from CONTRACTS §2 and the decided DESIGN_DELTA rows; the D02 token
// rows mirror qa/TEST_PLAN.md "D02: invite link token".
import { describe, it } from 'vitest';

describe('BE-05 first_day question (D12)', () => {
  it.todo('get_daily_question: day 1 of a new couple is the first_day special question (BE-05)');
});

describe('BE-04 invites v2 (D01, D04, D05, D06)', () => {
  it.todo(
    'create_invite returns { code, expires_at }: code is 4 digits, expires_at = now + 48 h (D01)',
  );
  it.todo('create_invite: COUPLE_FULL when the caller is in a two-member couple');
  it.todo(
    'create_invite twice: the first invite is revoked (one active invite per inviter); its code gives INVALID_CODE or INVITE_EXPIRED per CONTRACTS',
  );
  it.todo("accept_invite accepts 'BND·4827', 'bnd 4827', 'BND4827' and '4827' as the same code");
  it.todo('accept_invite after 48 h (expires_at pinned): INVITE_EXPIRED');
  it.todo(
    'accept_invite joins the inviter couple: the joiner solo couple and its answers are deleted (D04)',
  );
  it.todo('accept_invite: ALREADY_PAIRED only when the caller couple has two members (D04)');
  it.todo(
    'accept_invite: the inviter day-1 answer becomes readable to the joiner only after the joiner answers (reveal rule)',
  );
  it.todo(
    'accept_invite: RATE_LIMITED on the 6th failed attempt within 15 min (D02); a success does not count',
  );
  it.todo('accept_invite: the failed-attempt window resets after 15 min (time pinned, no sleep)');
  it.todo('accept_invite: RATE_LIMITED is per user; another user is not limited');
  it.todo(
    'invite_preview(p_code) as anon returns exactly { inviter_name, inviter_avatar_url, inviter_answered_today, expires_at } (D06)',
  );
  it.todo('invite_preview never returns answer text, email, ids or the partner_name');
  it.todo('invite_preview: INVALID_CODE, INVITE_EXPIRED, COUPLE_FULL');
  it.todo('invite_preview: RATE_LIMITED after 5 failed attempts in 15 min (anon too)');
  it.todo(
    'pair_invites: the inviter reads own invites; the joiner and outsiders read none; anon reads none',
  );
});

describe('BE-04 invite link token (D02)', () => {
  it.todo(
    'accept_invite with a valid code + valid token succeeds after 5 failed typed attempts (no RATE_LIMITED)',
  );
  it.todo('a valid-token accept does not count as a failed attempt');
  it.todo(
    'an invalid token (random, truncated, another invite token) with a valid code is treated as typed: RATE_LIMITED once the user has 5 failures',
  );
  it.todo('an invalid code with any token: INVALID_CODE, counted; RATE_LIMITED after 5');
  it.todo(
    'the token of an expired invite (48 h, time pinned) is rejected with INVITE_EXPIRED and does not skip the limit',
  );
  it.todo(
    'the token of a revoked invite (inviter created a new one) is rejected and does not skip the limit',
  );
  it.todo(
    'invite_preview as anon with a valid token previews; an invalid token counts toward the limit',
  );
  it.todo(
    'the token is never readable through the API (pair_invites select as inviter returns no plaintext or hash column)',
  );
});
