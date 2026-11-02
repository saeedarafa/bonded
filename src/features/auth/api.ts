import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import { googleEnv } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Supabase Auth (MOB-08). The only file that talks to `supabase.auth` for sign-in; hooks and
 * screens see `SignInResult` or an `AppError` with a translated message.
 */

/** `cancelled` = the person closed the Apple/Google sheet: not an error, show nothing. */
export type SignInResult = 'signedIn' | 'cancelled';

export type SessionUser = { userId: string };

/** Fires once with the stored session (INITIAL_SESSION), then on every sign-in/out. */
export function subscribeToSession(listener: (user: SessionUser | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    listener(session ? { userId: session.user.id } : null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw toAppError(error);
}

function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

// ---------- Apple (iOS only) ----------

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

function randomNonce(): string {
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Native Apple sheet, then `signInWithIdToken`. Apple gets the SHA-256 of the nonce, Supabase the raw one. */
export async function signInWithApple(): Promise<SignInResult> {
  try {
    const rawNonce = randomNonce();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new AppError('UNKNOWN', t('errors.generic'));
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw toAppError(error);
    return 'signedIn';
  } catch (error) {
    if (errorCodeOf(error) === 'ERR_REQUEST_CANCELED') return 'cancelled';
    throw toAppError(error);
  }
}

// ---------- Google ----------

let googleConfigured = false;

function configureGoogle(): void {
  if (googleConfigured) return;
  const { webClientId, iosClientId } = googleEnv();
  GoogleSignin.configure({
    // The web client id makes the ID token's audience the one Supabase checks.
    webClientId: webClientId || undefined,
    iosClientId: iosClientId || undefined,
  });
  googleConfigured = true;
}

export async function signInWithGoogle(): Promise<SignInResult> {
  try {
    configureGoogle();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') return 'cancelled';
    const idToken = response.data.idToken;
    if (!idToken) throw new AppError('UNKNOWN', t('errors.generic'));
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw toAppError(error);
    return 'signedIn';
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return 'cancelled';
    throw toAppError(error);
  }
}

// ---------- Email one-time code ----------

/** Supabase AuthError codes that get their own wording; everything else falls to `toAppError`. */
function emailError(error: unknown): AppError {
  const code = errorCodeOf(error);
  const status = (error as { status?: unknown } | null)?.status;
  if (code === 'validation_failed' || code === 'email_address_invalid') {
    return new AppError('UNKNOWN', t('auth.errors.email'));
  }
  if (code === 'otp_expired' || code === 'invalid_credentials') {
    return new AppError('UNKNOWN', t('auth.errors.wrongCode'));
  }
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    status === 429
  ) {
    return new AppError('RATE_LIMITED', t('errors.RATE_LIMITED'));
  }
  return toAppError(error);
}

/** Sends a 6-digit code to the address (creates the account on first use). */
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw emailError(error);
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw emailError(error);
}
