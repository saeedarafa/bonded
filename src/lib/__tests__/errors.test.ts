import en from '@/i18n/locales/en.json';
import {
  ANSWER_MAX_FREE,
  ANSWER_MAX_PREMIUM,
  answerMaxFrom,
  AppError,
  ERROR_CODES,
  isAppError,
  isErrorCode,
  isSignedOutError,
  messageFor,
  toAppError,
  unwrap,
  voiceMaxMsFrom,
} from '@/lib/errors';
import { Constants } from '@/types/database';

const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });

describe('errors: every CONTRACTS §2 code', () => {
  // BE-26 (#41) adds these two; main's generated types may not have them yet. The test passes on
  // both sides of that merge, and the copy is ready before the codes arrive.
  const JOIN_REQUEST_CODES = ['JOIN_REQUEST_EXPIRED', 'JOIN_REQUEST_FORBIDDEN'];
  // BE-41 (#175) adds ANSWER_TOO_LONG to the enum; the app maps it before and after that merge.
  const PENDING_CODES = [...JOIN_REQUEST_CODES, 'ANSWER_TOO_LONG'];
  const CONTRACT_CODES = [
    'ALREADY_PAIRED',
    // BE-35 (D37): a solo join without the archive consent (MOB-46).
    'CONFIRM_ARCHIVE',
    'COUPLE_FULL',
    'INVALID_CODE',
    // BE-48 (D50): a version-2 onboarding answer with an unknown id or key (MOB-37).
    'INVALID_ONBOARDING_ANSWER',
    // BE-40 (D45): a reaction that isn't exactly one emoji (MOB-53).
    'INVALID_REACTION',
    // BE-42 (D46): a voice_path that isn't an unused upload in my own folder (MOB-55).
    'INVALID_VOICE',
    'INVITE_EXPIRED',
    'LIBRARY_EXHAUSTED',
    'NOT_AUTHENTICATED',
    'NOT_PAIRED',
    'NUDGE_LIMIT',
    'OWN_CODE',
    'PARTNER_ALREADY_ANSWERED',
    'PREMIUM_REQUIRED',
    'QUESTION_UNAVAILABLE',
    'RATE_LIMITED',
    'SAVER_UNAVAILABLE',
    // BE-43 (D46): the couple's 20 voice uploads a day, and a recording over its cap (MOB-55b).
    'VOICE_LIMIT',
    'VOICE_TOO_LONG',
    // BE-44 (D48): little things over the daily limit, a bad kind/amount/id, undo after 5 s (MOB-58a).
    'LITTLE_THING_LIMIT',
    'INVALID_LITTLE_THING',
    'UNDO_EXPIRED',
  ];

  it('covers exactly the database enum', () => {
    expect(ERROR_CODES).toBe(Constants.public.Enums.error_code);
    const known = [...ERROR_CODES].filter((c) => !PENDING_CODES.includes(c)).sort();
    expect(known).toEqual([...CONTRACT_CODES].sort());
  });

  it('CONFIRM_ARCHIVE (BE-35) has its own text', () => {
    const error = toAppError(pg('CONFIRM_ARCHIVE'));
    expect(error.kind).toBe('CONFIRM_ARCHIVE');
    expect(error.message).toBe(en.errors.CONFIRM_ARCHIVE);
    expect(error.message).not.toBe(en.errors.generic);
  });

  it('INVALID_REACTION (BE-40) has its own text', () => {
    const error = toAppError(pg('INVALID_REACTION'));
    expect(error.kind).toBe('INVALID_REACTION');
    expect(error.message).toBe(en.errors.INVALID_REACTION);
    expect(error.message).not.toBe(en.errors.generic);
    expect(error.retryable).toBe(false);
  });

  it.each(JOIN_REQUEST_CODES)(
    '%s (BE-26) has its own text, ready before the enum has it',
    (code) => {
      const text = (en.errors as Record<string, string>)[code];
      expect(text).toBeTruthy();
      expect(text).not.toBe(en.errors.generic);
      const others = Object.entries(en.errors)
        .filter(([k]) => k !== code)
        .map(([, v]) => v);
      expect(others).not.toContain(text);
      const error = toAppError(pg(code));
      if (isErrorCode(code)) {
        expect(error.kind).toBe(code);
        expect(error.message).toBe(text);
      } else {
        // Before #41 merges the code is unknown to the app: generic text, never a raw code.
        expect(error.kind).toBe('UNKNOWN');
        expect(error.message).toBe(en.errors.generic);
      }
    },
  );

  it('the BE-26 copy says what happens next', () => {
    expect(en.errors.JOIN_REQUEST_EXPIRED).toMatch(/timed out.*again/i);
    expect(en.errors.JOIN_REQUEST_FORBIDDEN).toMatch(/only the person who shared the code/i);
  });

  it.each([...Constants.public.Enums.error_code])(
    '%s has its own catalogue text, not the generic one',
    (code) => {
      expect((en.errors as Record<string, string>)[code]).toBeTruthy();
      const error = toAppError(pg(code));
      expect(error.kind).toBe(code);
      expect(error.message).toBe(messageFor(code));
      expect(error.message).not.toBe(en.errors.generic);
      expect(error.message).not.toContain('{{');
    },
  );

  it('has no text shared by two different codes (except the sign-out pair)', () => {
    const messages = ERROR_CODES.filter((c) => c !== 'NOT_AUTHENTICATED').map((c) => messageFor(c));
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('QUESTION_UNAVAILABLE says what to do', () => {
    expect(toAppError(pg('QUESTION_UNAVAILABLE')).message).toMatch(/pick another/i);
  });

  it('uses the partner name where the copy has one, with a fallback', () => {
    expect(toAppError(pg('PARTNER_ALREADY_ANSWERED'), { partner: 'Sam' }).message).toBe(
      "Sam has already answered today's question.",
    );
    expect(toAppError(pg('PARTNER_ALREADY_ANSWERED')).message).toMatch(/^Your partner /);
    expect(toAppError(pg('PARTNER_ALREADY_ANSWERED'), { partner: '  ' }).message).toMatch(
      /^Your partner /,
    );
  });
});

describe('errors: classification', () => {
  it('reads the code from an edge function body and from a bare string', () => {
    expect(toAppError({ error: 'PREMIUM_REQUIRED', message: 'Needs premium' }).kind).toBe(
      'PREMIUM_REQUIRED',
    );
    expect(toAppError('NUDGE_LIMIT').kind).toBe('NUDGE_LIMIT');
    expect(toAppError(new Error('COUPLE_FULL')).kind).toBe('COUPLE_FULL');
  });

  it('treats permission denied (42501) as signed out', () => {
    const error = toAppError(pg('permission denied for function create_invite', '42501'));
    expect(error.kind).toBe('SIGNED_OUT');
    expect(error.signedOut).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it('does not sign out on a row-level-security violation (also 42501)', () => {
    const error = toAppError(
      pg('new row violates row-level security policy for table "answers"', '42501'),
    );
    expect(error.kind).toBe('UNKNOWN');
    expect(error.signedOut).toBe(false);
  });

  it('treats NOT_AUTHENTICATED, an expired JWT and a dead auth session as signed out', () => {
    expect(isSignedOutError(pg('NOT_AUTHENTICATED'))).toBe(true);
    expect(isSignedOutError({ message: 'JWT expired', code: 'PGRST301' })).toBe(true);
    expect(isSignedOutError({ message: 'x', status: 401 })).toBe(true);
    expect(
      isSignedOutError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }),
    ).toBe(true);
    expect(isSignedOutError({ message: 'x', code: 'refresh_token_not_found' })).toBe(true);
    expect(isSignedOutError(pg('NOT_PAIRED'))).toBe(false);
    expect(isSignedOutError(new Error('boom'))).toBe(false);
  });

  it('recognises offline and timeouts as retryable NETWORK errors', () => {
    for (const message of [
      'TypeError: Network request failed',
      'Failed to fetch',
      'The Internet connection appears to be offline.',
      'Request timed out',
    ]) {
      const error = toAppError({ message });
      expect(error.kind).toBe('NETWORK');
      expect(error.retryable).toBe(true);
    }
  });

  it('gives anything else the generic message', () => {
    for (const value of [
      new Error('relation "x" does not exist'),
      pg('SOMETHING_NEW'),
      null,
      undefined,
      42,
      {},
    ]) {
      const error = toAppError(value);
      expect(error.kind).toBe('UNKNOWN');
      expect(error.message).toBe(en.errors.generic);
      expect(error.retryable).toBe(true);
    }
  });

  it('is idempotent and exposes helpers', () => {
    const error = toAppError(pg('COUPLE_FULL'));
    expect(toAppError(error)).toBe(error);
    expect(error).toBeInstanceOf(AppError);
    expect(isAppError(pg('COUPLE_FULL'), 'COUPLE_FULL')).toBe(true);
    expect(isAppError(pg('COUPLE_FULL'), 'NOT_PAIRED')).toBe(false);
    expect(isErrorCode('COUPLE_FULL')).toBe(true);
    expect(isErrorCode('couple_full')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });

  it('never carries PostgREST details (they can hold answer text)', () => {
    const secret = 'I love how you laughed at my terrible joke';
    const error = toAppError({
      message: 'new row for relation "answers" violates check constraint "answers_body_check"',
      code: '23514',
      details: `Failing row contains (${secret}).`,
      hint: secret,
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error.message).not.toContain(secret);
    expect(error.stack ?? '').not.toContain(secret);
    expect(Object.keys(error).sort()).toEqual(['kind', 'name']);
  });
});

describe('errors: ANSWER_TOO_LONG (BE-41, D46)', () => {
  const tooLong = (details: unknown) => ({
    message: 'ANSWER_TOO_LONG',
    code: 'P0001',
    details,
    hint: null,
  });

  it('maps the code and reads the limit from the details JSON string', () => {
    const free = toAppError(tooLong('{"max":500}'));
    expect(free).toBeInstanceOf(AppError);
    expect(free.kind).toBe('ANSWER_TOO_LONG');
    expect(free.max).toBe(500);
    expect(free.message).toBe(
      'Your answer is longer than 500 characters. Shorten it a little, then lock it in again.',
    );
    expect(free.retryable).toBe(false);
    expect(free.signedOut).toBe(false);
    const premium = toAppError(tooLong('{"max":2000}'));
    expect(premium.max).toBe(2000);
    expect(premium.message).toContain('2000');
    expect(isAppError(tooLong('{"max":500}'), 'ANSWER_TOO_LONG')).toBe(true);
  });

  it('accepts already-parsed details; falls back to the free limit when they are missing or odd', () => {
    expect(toAppError(tooLong({ max: 2000 })).max).toBe(2000);
    for (const details of [null, '', 'not json', '{"max":"2000"}', '{"max":-1}', '{"max":1.5}']) {
      const error = toAppError(tooLong(details));
      expect(error.kind).toBe('ANSWER_TOO_LONG');
      expect(error.max).toBeUndefined();
      expect(error.message).toContain('500');
    }
    expect(answerMaxFrom('{"max":500}')).toBe(500);
    expect(answerMaxFrom(undefined)).toBeUndefined();
  });

  it('an edge function body or the bare code maps too', () => {
    expect(toAppError({ error: 'ANSWER_TOO_LONG' }).kind).toBe('ANSWER_TOO_LONG');
  });

  it('keeps only kind, name and the number: never other details', () => {
    const error = toAppError({ ...tooLong('{"max":500}'), hint: 'secret answer text' });
    expect(Object.keys(error).sort()).toEqual(['kind', 'max', 'name']);
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('the old 23514 check violation (before BE-41) stays the generic message', () => {
    const error = toAppError({
      message: 'new row for relation "answers" violates check constraint "answers_body_length"',
      code: '23514',
      details: 'Failing row contains (x).',
      hint: null,
    });
    expect(error.kind).toBe('UNKNOWN');
    expect(error.message).toBe(en.errors.generic);
  });

  it('answer limits: 500 free, 2000 Premium', () => {
    expect(ANSWER_MAX_FREE).toBe(500);
    expect(ANSWER_MAX_PREMIUM).toBe(2000);
  });
});

describe('errors: unwrap', () => {
  it('returns data when there is no error', () => {
    expect(unwrap({ data: { id: 1 }, error: null })).toEqual({ id: 1 });
  });

  it('throws an AppError, with the partner name when given', () => {
    expect(() => unwrap({ data: null, error: pg('OWN_CODE') })).toThrow(AppError);
    try {
      unwrap({ data: null, error: pg('PARTNER_ALREADY_ANSWERED') }, { partner: 'Maya' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).kind).toBe('PARTNER_ALREADY_ANSWERED');
      expect((e as AppError).message).toContain('Maya');
    }
  });
});

describe('errors: voice (BE-42, BE-43, D46)', () => {
  it('VOICE_LIMIT (BE-43) has its own text, also from an edge-function body', () => {
    const error = toAppError({ message: 'VOICE_LIMIT', code: 'P0001', details: '{"max":20}' });
    expect(error.kind).toBe('VOICE_LIMIT');
    expect(error.message).toBe(en.errors.VOICE_LIMIT);
    expect(error.message).not.toBe(messageFor('UNKNOWN'));
    expect(toAppError({ error: 'VOICE_LIMIT' }).kind).toBe('VOICE_LIMIT');
  });

  it('VOICE_TOO_LONG (BE-43) carries the limit in seconds from details.max_ms', () => {
    const answer = toAppError({
      message: 'VOICE_TOO_LONG',
      code: 'P0001',
      details: '{"max_ms":90000,"max_bytes":409600}',
    });
    expect(answer.kind).toBe('VOICE_TOO_LONG');
    expect(answer.max).toBe(90);
    expect(answer.message).toContain('90 seconds');
    const message = toAppError(pg('VOICE_TOO_LONG'), {});
    expect(message.max).toBeUndefined();
    expect(message.message).toContain('90 seconds');
    const thread = toAppError({
      ...pg('VOICE_TOO_LONG'),
      details: '{"max_ms":60000,"max_bytes":307200}',
    });
    expect(thread.max).toBe(60);
    expect(messageFor('VOICE_TOO_LONG', { max: 60 })).toContain('60 seconds');
    expect(voiceMaxMsFrom('not json')).toBeUndefined();
    expect(voiceMaxMsFrom({ max_ms: 60000 })).toBe(60000);
  });

  it.each([
    'VOICE_DENIED',
    'VOICE_TOO_LARGE',
    'VOICE_FORMAT',
    'INVALID_VOICE',
    'VOICE_LIMIT',
    'VOICE_TOO_LONG',
  ] as const)('%s has its own text', (kind) => {
    expect(messageFor(kind)).not.toBe(messageFor('UNKNOWN'));
    expect(messageFor(kind)).not.toMatch(/errors\./);
  });
});

describe('errors: little things (BE-44, D48)', () => {
  it.each(['LITTLE_THING_LIMIT', 'INVALID_LITTLE_THING', 'UNDO_EXPIRED'] as const)(
    '%s has its own text, also from an edge-function body',
    (code) => {
      const error = toAppError({ message: code, code: 'P0001', details: null });
      expect(error.kind).toBe(code);
      expect(error.message).toBe(en.errors[code]);
      expect(error.message).not.toBe(messageFor('UNKNOWN'));
      expect(toAppError({ error: code }).kind).toBe(code);
    },
  );

  it('LITTLE_THING_LIMIT shows no count (D48) and ignores details', () => {
    const error = toAppError({
      message: 'LITTLE_THING_LIMIT',
      code: 'P0001',
      details: '{"kind":"kiss","more_with_premium":true}',
    });
    expect(error.message).toBe(en.errors.LITTLE_THING_LIMIT);
    expect(error.message).not.toMatch(/\d/);
    expect(error.max).toBeUndefined();
  });
});
