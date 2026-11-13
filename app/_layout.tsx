import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Initialise i18next before the first render (MOB-29).
import '@/i18n';
import { useAnalytics } from '@/features/analytics/useAnalytics';
import { SessionProvider, useSession } from '@/features/auth/session';
import { useAnswerQueueSync } from '@/features/daily/answerQueue';
import { useOnboardingAnswerSync } from '@/features/onboarding/answerSync';
import { useRecordOnboardingStep } from '@/features/onboarding/resume';
import { usePurchasesIdentity } from '@/features/premium/hooks';
import { PushBannerHost } from '@/features/push/components/PushBanner';
import { usePushTokenSync } from '@/features/push/registration';
import { configureForegroundPresentation, usePushRouting } from '@/features/push/routing';
import { useReviewRouteSuppression, useReviewSessions } from '@/features/review/review';
import { useWidgetSync } from '@/features/widgets/useWidgetSync';
import { DataProvider } from '@/lib/DataProvider';
import { ThemeProvider, ToastHost, useBondedFonts, useTheme } from '@/ui';

void SplashScreen.preventAutoHideAsync();
// Pushes in the foreground show our banner (37), not the system one (MOB-15).
configureForegroundPresentation();

/**
 * Auth gate (MOB-08). Signed-in only: the app proper (tabs, pairing, offers, milestones).
 * Always reachable: `index` (it decides where to go), onboarding, sign-in, the join flow and the
 * invite link `j/[code]` (J3 shows the inviter before anyone signs in). When the session ends,
 * for any reason, the protected screens leave the stack and `/` sends the person back to onboarding.
 */
function RootStack() {
  const { colors } = useTheme();
  const { status } = useSession();
  const signedIn = status === 'signedIn';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(pairing)" />
        <Stack.Screen name="(offer)" />
        <Stack.Screen name="milestone/[n]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="question" />
        <Stack.Screen name="ended" />
      </Stack.Protected>
    </Stack>
  );
}

/** Push taps (warm and cold start) and foreground pushes; needs the navigator, so it renders after it. */
function PushRouter() {
  usePushRouting();
  return null;
}

/** Analytics (MOB-24): screen views need the navigator, so this renders after it too. */
function AnalyticsRoot() {
  useAnalytics(useSession());
  return null;
}

/** Holds the splash screen until the fonts and the stored session are both ready. */
function Gate() {
  const session = useSession();
  const { status, userId } = session;
  // RevenueCat follows the session: logIn(user.id) / logOut (MOB-19, CONTRACTS §6).
  usePurchasesIdentity(session);
  // Answers written offline send themselves when the connection returns (MOB-14).
  useAnswerQueueSync(userId);
  // Onboarding answers (03/05/06) reach the server once, retried until they do (MOB-37, D38).
  useOnboardingAnswerSync(userId);
  // The onboarding step in front, so an app kill resumes there (MOB-61b).
  useRecordOnboardingStep();
  // This device's push token, registered once per change (MOB-15). Never prompts.
  usePushTokenSync(userId);
  // Sessions for the in-app review rule: never in the first session (MOB-17), nor in one that
  // began with sign-in or onboarding (#68).
  useReviewSessions(status);
  // D62: no review prompt in a session that showed a paywall or an offer screen.
  useReviewRouteSuppression();
  // Home and lock-screen widgets follow Today; signing out clears them (MOB-30, D26/D47).
  useWidgetSync(session);
  const fontsReady = useBondedFonts();
  const ready = fontsReady && status !== 'loading';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <>
      <RootStack />
      <PushRouter />
      <AnalyticsRoot />
      <ToastHost />
      <PushBannerHost />
      <StatusBar style="auto" />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DataProvider>
          <SessionProvider>
            <ThemeProvider>
              <Gate />
            </ThemeProvider>
          </SessionProvider>
        </DataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
