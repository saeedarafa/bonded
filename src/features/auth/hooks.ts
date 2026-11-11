import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';

import {
  completeEmailAuthCallback,
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  signOut,
  verifyEmailCode,
  type SignInResult,
  type SessionUser,
} from '@/features/auth/api';
import { parseEmailAuthCallback } from '@/features/auth/emailLinks';
import { t } from '@/i18n';
import { track } from '@/lib/analytics';
import { AppError } from '@/lib/errors';

// Analytics (MOB-24): the method and the error kind only; `signed_up` / `signed_in` follow from
// the session (features/analytics).
export function useSignInWithApple() {
  return useMutation<SignInResult, AppError>({
    mutationFn: signInWithApple,
    onMutate: () => track('sign_in_started', { method: 'apple' }),
    onError: (e) => track('sign_in_failed', { method: 'apple', error_code: e.kind }),
  });
}

export function useSignInWithGoogle() {
  return useMutation<SignInResult, AppError>({
    mutationFn: signInWithGoogle,
    onMutate: () => track('sign_in_started', { method: 'google' }),
    onError: (e) => track('sign_in_failed', { method: 'google', error_code: e.kind }),
  });
}

export function useSendEmailCode() {
  return useMutation<void, AppError, string>({ mutationFn: sendEmailCode });
}

export function useVerifyEmailCode() {
  return useMutation<void, AppError, { email: string; code: string }>({
    mutationFn: ({ email, code }) => verifyEmailCode(email, code),
    onError: (e) => track('sign_in_failed', { method: 'email', error_code: e.kind }),
  });
}

export function useSignOut() {
  return useMutation<void, AppError>({ mutationFn: signOut });
}

/** Read the cold URL and subscribe before releasing the signed-out auth gate. */
export function useEmailAuthLinks(onSession: (user: SessionUser) => void) {
  const [initialLinkReady, setInitialLinkReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const { mutateAsync } = useMutation({
    mutationFn: completeEmailAuthCallback,
    // Credentials must not enter the persisted offline mutation queue, or be retried/replayed.
    networkMode: 'always',
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    let alive = true;
    const seen = new Set<string>();
    let queue = Promise.resolve();
    const handle = (url: string | null | undefined) => {
      if (!alive || !url) return queue;
      const callback = parseEmailAuthCallback(url);
      if (!callback || seen.has(url)) return queue;
      seen.add(url);
      if (seen.size > 8) seen.delete(seen.values().next().value!);
      setPending((n) => n + 1);
      setError(null);
      queue = queue.then(async () => {
        if (!alive) return;
        setError(null);
        try {
          const user = await mutateAsync(callback);
          if (alive) onSession(user);
        } catch (e) {
          if (alive) setError(e as AppError);
        } finally {
          if (alive) setPending((n) => n - 1);
        }
      });
      return queue;
    };
    const sub = Linking.addEventListener('url', ({ url }) => void handle(url));
    void Linking.getInitialURL()
      .then(handle)
      .catch(() => {
        if (alive) setError(new AppError('UNKNOWN', t('auth.errors.link')));
      })
      .finally(() => {
        if (alive) setInitialLinkReady(true);
      });
    return () => {
      alive = false;
      sub.remove();
      seen.clear();
    };
  }, [mutateAsync, onSession]);

  return { pending: !initialLinkReady || pending > 0, error, clearError };
}
