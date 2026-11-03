import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { unregisterPushToken } from '@/features/push/registration';
import {
  sendEmailCode,
  signOut,
  signInWithApple,
  signInWithGoogle,
  subscribeToSession,
  verifyEmailCode,
} from '@/features/auth/api';

const mockSignInWithIdToken = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockUnsubscribe = jest.fn();
const mockSignOut = jest.fn((_args: unknown) => Promise.resolve({ error: null }));
jest.mock('@/features/push/registration', () => ({
  unregisterPushToken: jest.fn(() => Promise.resolve()),
}));
let authListener: ((event: string, session: { user: { id: string } } | null) => void) | undefined;

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: (args: unknown) => mockSignInWithIdToken(args),
      signInWithOtp: (args: unknown) => mockSignInWithOtp(args),
      verifyOtp: (args: unknown) => mockVerifyOtp(args),
      signOut: (args: unknown) => mockSignOut(args),
      onAuthStateChange: (cb: typeof authListener) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
  },
}));

const mockAppleSignIn = AppleAuthentication.signInAsync as jest.Mock;
const mockGoogleSignIn = GoogleSignin.signIn as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('subscribeToSession', () => {
  it('reports the user id, null on sign-out, and unsubscribes', () => {
    const listener = jest.fn();
    const stop = subscribeToSession(listener);
    authListener?.('INITIAL_SESSION', { user: { id: 'u1' } });
    authListener?.('SIGNED_OUT', null);
    expect(listener.mock.calls).toEqual([[{ userId: 'u1' }], [null]]);
    stop();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('removes the push token of this phone first, while the session still works (MOB-15)', async () => {
    await signOut();
    expect(unregisterPushToken).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    const unregistered = jest.mocked(unregisterPushToken).mock.invocationCallOrder[0] ?? 0;
    expect(unregistered).toBeLessThan(mockSignOut.mock.invocationCallOrder[0] ?? 0);
  });
});

describe('signInWithApple', () => {
  it('sends Apple the hashed nonce and Supabase the raw one', async () => {
    mockAppleSignIn.mockResolvedValue({ identityToken: 'apple-jwt' });
    mockSignInWithIdToken.mockResolvedValue({ error: null });
    await expect(signInWithApple()).resolves.toBe('signedIn');
    const { nonce: hashed } = mockAppleSignIn.mock.calls[0][0] as { nonce: string };
    const args = mockSignInWithIdToken.mock.calls[0][0] as { nonce: string; token: string };
    expect(args).toMatchObject({ provider: 'apple', token: 'apple-jwt' });
    expect(hashed).toBe(`h(${args.nonce})`);
    expect(args.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('treats closing the sheet as cancelled, not an error', async () => {
    mockAppleSignIn.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    await expect(signInWithApple()).resolves.toBe('cancelled');
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('maps a Supabase failure to an AppError', async () => {
    mockAppleSignIn.mockResolvedValue({ identityToken: 'apple-jwt' });
    mockSignInWithIdToken.mockResolvedValue({ error: { message: 'Network request failed' } });
    await expect(signInWithApple()).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  it('fails cleanly without an identity token', async () => {
    mockAppleSignIn.mockResolvedValue({ identityToken: null });
    await expect(signInWithApple()).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });
});

describe('signInWithGoogle', () => {
  it('exchanges the Google ID token', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'g-jwt' } });
    mockSignInWithIdToken.mockResolvedValue({ error: null });
    await expect(signInWithGoogle()).resolves.toBe('signedIn');
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'g-jwt' });
  });

  it('cancelled response and cancel error both mean cancelled', async () => {
    mockGoogleSignIn.mockResolvedValueOnce({ type: 'cancelled', data: null });
    await expect(signInWithGoogle()).resolves.toBe('cancelled');
    mockGoogleSignIn.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
    await expect(signInWithGoogle()).resolves.toBe('cancelled');
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });
});

describe('email code', () => {
  it('asks Supabase for a code and creates the account on first use', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    await sendEmailCode(' maya@example.com ');
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'maya@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('verifies the 6-digit code as an email OTP', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    await verifyEmailCode('maya@example.com', '123456');
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'maya@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('gives a wrong or expired code its own message', async () => {
    mockVerifyOtp.mockResolvedValue({ error: { code: 'otp_expired', message: 'x', status: 403 } });
    await expect(verifyEmailCode('a@b.co', '000000')).rejects.toThrow(/isn't right/);
  });

  it('maps rate limits and bad addresses', async () => {
    mockSignInWithOtp.mockResolvedValueOnce({
      error: { code: 'over_email_send_rate_limit', message: 'x', status: 429 },
    });
    await expect(sendEmailCode('a@b.co')).rejects.toMatchObject({ kind: 'RATE_LIMITED' });
    mockSignInWithOtp.mockResolvedValueOnce({ error: { code: 'validation_failed', message: 'x' } });
    await expect(sendEmailCode('nope')).rejects.toThrow(/email address/);
  });
});
