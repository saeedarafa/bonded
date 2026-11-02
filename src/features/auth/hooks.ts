import { useMutation } from '@tanstack/react-query';

import {
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  signOut,
  verifyEmailCode,
  type SignInResult,
} from '@/features/auth/api';
import type { AppError } from '@/lib/errors';

export function useSignInWithApple() {
  return useMutation<SignInResult, AppError>({ mutationFn: signInWithApple });
}

export function useSignInWithGoogle() {
  return useMutation<SignInResult, AppError>({ mutationFn: signInWithGoogle });
}

export function useSendEmailCode() {
  return useMutation<void, AppError, string>({ mutationFn: sendEmailCode });
}

export function useVerifyEmailCode() {
  return useMutation<void, AppError, { email: string; code: string }>({
    mutationFn: ({ email, code }) => verifyEmailCode(email, code),
  });
}

export function useSignOut() {
  return useMutation<void, AppError>({ mutationFn: signOut });
}
