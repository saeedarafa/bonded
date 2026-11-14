import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { unregisterPushToken } from '@/features/push/registration';
import {
  completeEmailAuthCallback,
  sendEmailCode,
  signOut,
  signInWithApple,
  signInWithGoogle,
  subscribeToSession,
  verifyEmailCode,
} from '@/features/auth/api';
import { parseEmailAuthCallback } from '@/features/auth/emailLinks';

const mockSignInWithIdToken = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockExchangeCode = jest.fn();
const mockSetSession = jest.fn();
const mockUnsubscribe = jest.fn();
const mockSignOut = jest.fn((_args: unknown) => Promise.resolve({ error: null }));
const mockClearHttpCache = jest.fn();
jest.mock('@/lib/httpCache', () => ({ clearHttpCache: () => mockClearHttpCache() }));
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
      exchangeCodeForSession: (code: string) => mockExchangeCode(code),
      setSession: (args: unknown) => mockSetSession(args),
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

  it('empties the OS HTTP cache after the local sign-out (MOB-89)', async () => {
    await signOut();
    expect(mockClearHttpCache).toHaveBeenCalledTimes(1);
    expect(mockSignOut.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      mockClearHttpCache.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('empties the OS HTTP cache even when the sign-out fails or throws (MOB-89)', async () => {
    mockSignOut.mockResolvedValueOnce({ error: { message: 'x' } } as never);
    await expect(signOut()).rejects.toBeDefined();
    expect(mockClearHttpCache).toHaveBeenCalledTimes(1);
    mockSignOut.mockRejectedValueOnce(new Error('storage'));
    await expect(signOut()).rejects.toThrow('storage');
    expect(mockClearHttpCache).toHaveBeenCalledTimes(2);
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
      options: { shouldCreateUser: true, emailRedirectTo: 'bonded://auth/callback' },
    });
  });
});

describe('email link session establishment', () => {
  const data = { session: { user: { id: 'u1' } } };

  it('exchanges a PKCE code with Supabase before reporting signed in', async () => {
    mockExchangeCode.mockResolvedValue({ data, error: null });
    await expect(completeEmailAuthCallback({ kind: 'pkce', code: 'pkce-code' })).resolves.toEqual({
      userId: 'u1',
    });
    expect(mockExchangeCode).toHaveBeenCalledWith('pkce-code');
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it.each([
    'bonded://auth/callback?access_token=a&refresh_token=r',
    'bonded://auth/callback#access_token=a&refresh_token=r',
    'bonded://auth/callback?access_token=a#refresh_token=r',
    'bonded://auth/callback?code=c&access_token=a&refresh_token=r',
    'bonded://auth/callback#code=c&access_token=a&refresh_token=r',
    'bonded://auth/callback?code=c#access_token=a&refresh_token=r',
    'bonded://auth/callback?access_token=a&refresh_token=r#code=c',
    'bonded://auth/callback?code=c&access_token=',
    'bonded://auth/callback?code=c#refresh_token=',
    'bonded://#access_token=a&refresh_token=r',
    'bonded://?code=c#access_token=a&refresh_token=r',
  ])('rejects %s without contacting auth or changing the existing session', async (url) => {
    const listener = jest.fn();
    const stop = subscribeToSession(listener);
    authListener?.('INITIAL_SESSION', { user: { id: 'existing' } });
    // Either credential method would replace the current session if accidentally called.
    const swapSession = async () => {
      authListener?.('SIGNED_IN', data.session);
      return { data, error: null };
    };
    mockExchangeCode.mockImplementation(swapSession);
    mockSetSession.mockImplementation(swapSession);
    const callback = parseEmailAuthCallback(url);
    expect(callback).toEqual({ kind: 'invalid' });
    await expect(completeEmailAuthCallback(callback!)).rejects.toThrow(/Request a new email/);
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(listener.mock.calls).toEqual([[{ userId: 'existing' }]]);
    stop();
  });

  it.each(['otp_expired', 'flow_state_not_found', 'flow_state_expired', 'bad_code_verifier'])(
    'gives %s a safe actionable error, not the raw server error',
    async (code) => {
      mockExchangeCode.mockResolvedValue({
        data: { session: null },
        error: { code, message: 'secret callback URL and tokens', status: 400 },
      });
      await expect(completeEmailAuthCallback({ kind: 'pkce', code: 'used' })).rejects.toThrow(
        /Request a new email/,
      );
    },
  );

  it('rejects malformed callbacks without contacting Supabase and rejects missing sessions', async () => {
    await expect(completeEmailAuthCallback({ kind: 'invalid' })).rejects.toThrow(/sign-in link/);
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    mockExchangeCode.mockResolvedValue({ data: { session: null }, error: null });
    await expect(completeEmailAuthCallback({ kind: 'pkce', code: 'c' })).rejects.toThrow(
      /sign-in link/,
    );
  });

  it('preserves meaningful network and rate limit failures without exposing secrets', async () => {
    mockExchangeCode.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(completeEmailAuthCallback({ kind: 'pkce', code: 'c' })).rejects.toMatchObject({
      kind: 'NETWORK',
    });
    mockExchangeCode.mockResolvedValueOnce({
      data: { session: null },
      error: { code: 'over_request_rate_limit', message: 'secret', status: 429 },
    });
    await expect(completeEmailAuthCallback({ kind: 'pkce', code: 'c' })).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
    });
  });
});

describe('email code verification', () => {
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
