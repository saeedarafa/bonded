import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { BackHandler, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isAppleSignInAvailable, type SignInResult } from '@/features/auth/api';
import {
  useSendEmailCode,
  useSignInWithApple,
  useSignInWithGoogle,
  useVerifyEmailCode,
} from '@/features/auth/hooks';
import { useTranslation } from '@/i18n';
import { inviteDomain } from '@/lib/env';
import type { AppError } from '@/lib/errors';
import { Banner, Button, Mascot, ProgressBar, Text, TextField, TopBar, useTheme } from '@/ui';

const OTP_LENGTH = 6;
const EMAIL_SHAPE = /^\S+@\S+\.\S+$/;

type Step = 'options' | 'email' | 'code';

type Props = {
  /** Screen id for test ids: `08` (main onboarding) or `J4` (joining partner). */
  screenId: '08' | 'J4';
  /** Progress in the flow: 4 of 4 for screen 08, 1 of 3 for J4. */
  step: number;
  total: number;
  title: string;
  body: string;
  mascotSize: number;
  onBack: () => void;
  /** Called once after a session exists. */
  onSignedIn: () => void;
};

function openLegal(page: 'terms' | 'privacy') {
  const domain = inviteDomain();
  if (domain) void Linking.openURL(`https://${domain}/${page}`);
}

/**
 * Screens 08 and J4 share this (DESIGN: "J4 shares component with 08"): Apple (iOS, the native
 * HIG button), Google, and an email one-time code. The email steps are not on the boards, see
 * docs/design/GAPS.md. The session itself is picked up by the auth gate; this only reports done.
 */
export function SignInView({
  screenId,
  step: stepNumber,
  total,
  title,
  body,
  mascotSize,
  onBack,
  onSignedIn,
}: Props) {
  const { t } = useTranslation();
  const { colors, space, size, scheme } = useTheme();
  const [step, setStep] = useState<Step>('options');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const apple = useSignInWithApple();
  const google = useSignInWithGoogle();
  const sendCode = useSendEmailCode();
  const verify = useVerifyEmailCode();

  useEffect(() => {
    let alive = true;
    void isAppleSignInAvailable().then((ok) => alive && setAppleAvailable(ok));
    return () => {
      alive = false;
    };
  }, []);

  // Android back closes the email steps first, then leaves the screen.
  useEffect(() => {
    if (step === 'options') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBackOneStep();
      return true;
    });
    return () => sub.remove();
  });

  function goBackOneStep() {
    setFieldError(null);
    setNotice(null);
    if (step === 'code') setStep('email');
    else if (step === 'email') setStep('options');
    else onBack();
  }

  const providerError: AppError | null = apple.error ?? google.error;
  const busy = apple.isPending || google.isPending;

  function finish(result: SignInResult) {
    if (result === 'signedIn') onSignedIn();
  }

  function submitEmail() {
    if (!EMAIL_SHAPE.test(email.trim())) {
      setFieldError(t('auth.errors.email'));
      return;
    }
    setFieldError(null);
    sendCode.mutate(email, {
      onSuccess: () => {
        setCode('');
        setStep('code');
      },
      onError: (e) => setFieldError(e.message),
    });
  }

  function submitCode() {
    if (code.length !== OTP_LENGTH) {
      setFieldError(t('auth.errors.codeLength'));
      return;
    }
    setFieldError(null);
    verify.mutate(
      { email, code },
      { onSuccess: onSignedIn, onError: (e) => setFieldError(e.message) },
    );
  }

  function resend() {
    setFieldError(null);
    sendCode.mutate(email, {
      onSuccess: () => setNotice(t('auth.resent')),
      onError: (e) => setFieldError(e.message),
    });
  }

  const header =
    step === 'options'
      ? { title, body }
      : step === 'email'
        ? { title: t('auth.emailTitle'), body: t('auth.emailBody') }
        : { title: t('auth.codeTitle'), body: t('auth.codeBody', { email: email.trim() }) };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={`${screenId}-screen`}>
      <TopBar
        testID={`${screenId}-top`}
        onBack={goBackOneStep}
        center={
          <ProgressBar
            testID={`${screenId}-progress`}
            value={stepNumber / total}
            label={t('auth.step', { step: stepNumber, total })}
          />
        }
        right={
          <Text variant="caption" tone="text2" importantForAccessibility="no-hide-descendants">
            {t('auth.stepCount', { step: stepNumber, total })}
          </Text>
        }
      />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          paddingHorizontal: space.gutter,
          paddingTop: space.hero,
          paddingBottom: space.xxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', gap: space.lg }}>
          <Mascot mood="together" size={mascotSize} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {header.title}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {header.body}
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          {step === 'options' && (
            <>
              {providerError && !providerError.signedOut ? (
                <Banner tone="error" message={providerError.message} testID={`${screenId}-error`} />
              ) : null}
              {appleAvailable ? (
                <AppleAuthentication.AppleAuthenticationButton
                  testID={`${screenId}-apple`}
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={
                    scheme === 'dark'
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={size.button / 2}
                  style={{ height: size.button, width: '100%' }}
                  onPress={() => {
                    if (!busy) apple.mutate(undefined, { onSuccess: finish });
                  }}
                />
              ) : null}
              <Button
                testID={`${screenId}-google`}
                variant="ghost"
                label={t('auth.google')}
                loading={google.isPending}
                onPress={() => {
                  if (!busy) google.mutate(undefined, { onSuccess: finish });
                }}
              />
              <Button
                testID={`${screenId}-email`}
                variant="ghost"
                icon="mail"
                label={t('auth.email')}
                onPress={() => setStep('email')}
              />
              <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
                {t('auth.legalIntro')}{' '}
                <Text
                  variant="caption"
                  tone="text2"
                  accessibilityRole="link"
                  style={{ textDecorationLine: 'underline' }}
                  onPress={() => openLegal('terms')}
                >
                  {t('auth.terms')}
                </Text>{' '}
                {t('auth.legalAnd')}{' '}
                <Text
                  variant="caption"
                  tone="text2"
                  accessibilityRole="link"
                  style={{ textDecorationLine: 'underline' }}
                  onPress={() => openLegal('privacy')}
                >
                  {t('auth.privacy')}
                </Text>
                .
              </Text>
            </>
          )}

          {step === 'email' && (
            <>
              <TextField
                testID={`${screenId}-email-field`}
                label={t('auth.emailLabel')}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setFieldError(null);
                }}
                error={fieldError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={submitEmail}
              />
              <Button
                testID={`${screenId}-send-code`}
                label={t('auth.sendCode')}
                loading={sendCode.isPending}
                onPress={submitEmail}
              />
            </>
          )}

          {step === 'code' && (
            <>
              {notice ? <Banner message={notice} testID={`${screenId}-notice`} /> : null}
              <TextField
                testID={`${screenId}-code-field`}
                label={t('auth.codeLabel')}
                value={code}
                onChangeText={(v) => {
                  setCode(v.replace(/\D/g, '').slice(0, OTP_LENGTH));
                  setFieldError(null);
                  setNotice(null);
                }}
                error={fieldError}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={OTP_LENGTH}
                returnKeyType="done"
                onSubmitEditing={submitCode}
              />
              <Button
                testID={`${screenId}-verify`}
                label={t('auth.verify')}
                loading={verify.isPending}
                onPress={submitCode}
              />
              <Button
                testID={`${screenId}-resend`}
                variant="ghost"
                label={t('auth.resend')}
                loading={sendCode.isPending}
                onPress={resend}
              />
              <Button
                testID={`${screenId}-change-email`}
                variant="ghost"
                label={t('auth.changeEmail')}
                onPress={() => {
                  setFieldError(null);
                  setNotice(null);
                  setStep('email');
                }}
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
