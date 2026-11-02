import { t } from '@/i18n';
import { Constants, type Database } from '@/types/database';

/**
 * CONTRACTS §2 error handling (MOB-06).
 *
 * The backend raises exactly one of the `error_code` enum values as the exception message
 * (SQLSTATE P0001). This file turns any thrown value (PostgrestError, AuthError, fetch failure,
 * edge function body) into an `AppError` with a user-facing message from the i18n catalogue
 * (`errors.*`, see src/i18n/locales/en.json).
 *
 * Privacy: an AppError keeps only the kind and the translated message. PostgREST `details`/`hint`
 * can contain row values (answer or message text), so they are never copied, stored or logged.
 */

export type ErrorCode = Database['public']['Enums']['error_code'];

/** The enum, straight from the generated types: a new backend code shows up here automatically. */
export const ERROR_CODES: readonly ErrorCode[] = Constants.public.Enums.error_code;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * - an `error_code` from the database,
 * - `SIGNED_OUT`: Postgres `permission denied` (42501) or an expired/invalid JWT: not a code,
 *   treat as signed out (CONTRACTS §2),
 * - `NETWORK`: no connection or timeout,
 * - `UNKNOWN`: anything else, shown as a generic message.
 */
export type AppErrorKind = ErrorCode | 'SIGNED_OUT' | 'NETWORK' | 'UNKNOWN';

export interface MessageOptions {
  /** Partner's first name where the copy uses it ("Sam already answered"). */
  partner?: string | null | undefined;
}

/** Kinds that mean the session is gone: go back to auth. */
const SIGNED_OUT_KINDS: readonly AppErrorKind[] = ['NOT_AUTHENTICATED', 'SIGNED_OUT'];

export class AppError extends Error {
  readonly kind: AppErrorKind;

  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
  }

  /** The session is gone (or never existed): send the user back to auth. */
  get signedOut(): boolean {
    return SIGNED_OUT_KINDS.includes(this.kind);
  }

  /** Worth a "Try again": transient. Every database code is a definite answer, so retrying is pointless. */
  get retryable(): boolean {
    return this.kind === 'NETWORK' || this.kind === 'UNKNOWN';
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function text(value: unknown, key: string): string | undefined {
  const v = field(value, key);
  return typeof v === 'string' ? v : undefined;
}

const NETWORK_MESSAGE =
  /network request failed|failed to fetch|network error|networkerror|timed? ?out|load failed|fetch failed|internet connection appears to be offline/i;

/** Auth error codes (supabase-js AuthError.code) that mean the session can't be recovered. */
const DEAD_SESSION_AUTH_CODES = ['refresh_token_not_found', 'session_not_found', 'bad_jwt'];

function classify(error: unknown): AppErrorKind {
  const message = (text(error, 'message') ?? '').trim();
  const code = text(error, 'code');
  const status = field(error, 'status');

  // 1. Exact database code: Postgrest message, or an edge function body `{ error: 'CODE' }`.
  if (isErrorCode(message)) return message;
  const body = text(error, 'error');
  if (isErrorCode(body)) return body;
  if (isErrorCode(error)) return error;

  // 2. Signed out. 42501 is `permission denied`: anon calling an RPC (CONTRACTS §2). The same
  //    SQLSTATE is also raised by a row-level-security violation for a signed-in user: that is
  //    not a sign-out, so it falls through to UNKNOWN.
  if (code === '42501') return /row-level security/i.test(message) ? 'UNKNOWN' : 'SIGNED_OUT';
  if (code === 'PGRST301' || code === 'PGRST303' || status === 401) return 'SIGNED_OUT';
  if (text(error, 'name') === 'AuthSessionMissingError') return 'SIGNED_OUT';
  if (code !== undefined && DEAD_SESSION_AUTH_CODES.includes(code)) return 'SIGNED_OUT';

  // 3. Offline / timeout.
  if (NETWORK_MESSAGE.test(message) || text(error, 'name') === 'AuthRetryableFetchError') {
    return 'NETWORK';
  }
  return 'UNKNOWN';
}

/** User-facing text for a kind. The template-literal key is checked against en.json by tsc. */
export function messageFor(kind: AppErrorKind, options: MessageOptions = {}): string {
  switch (kind) {
    case 'SIGNED_OUT':
      return t('errors.signedOut');
    case 'NETWORK':
      return t('errors.network');
    case 'UNKNOWN':
      return t('errors.generic');
    default:
      return t(`errors.${kind}`, {
        partner: options.partner?.trim() || t('errors.partnerFallback'),
      });
  }
}

/** Any thrown value to an AppError (idempotent). Unknown things get the generic message. */
export function toAppError(error: unknown, options: MessageOptions = {}): AppError {
  if (error instanceof AppError) return error;
  const kind = classify(error);
  return new AppError(kind, messageFor(kind, options));
}

export function isAppError(error: unknown, kind: AppErrorKind): boolean {
  return toAppError(error).kind === kind;
}

/** True when the error means "go back to auth" (NOT_AUTHENTICATED, 42501, expired JWT). */
export function isSignedOutError(error: unknown): boolean {
  return toAppError(error).signedOut;
}

/**
 * supabase-js result to value, or throw an AppError. The one place api.ts files turn
 * `{ data, error }` into exceptions, so hooks and screens only ever see AppError.
 */
export function unwrap<T>(result: { data: T; error: unknown }, options?: MessageOptions): T {
  if (result.error) throw toAppError(result.error, options);
  return result.data;
}
