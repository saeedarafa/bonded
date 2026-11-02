import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Initialise i18next before the first render (MOB-29).
import '@/i18n';
import { SessionProvider, useSession } from '@/features/auth/session';
import { DataProvider } from '@/lib/DataProvider';
import { ThemeProvider, useBondedFonts, useTheme } from '@/ui';

void SplashScreen.preventAutoHideAsync();

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
      </Stack.Protected>
    </Stack>
  );
}

/** Holds the splash screen until the fonts and the stored session are both ready. */
function Gate() {
  const { status } = useSession();
  const fontsReady = useBondedFonts();
  const ready = fontsReady && status !== 'loading';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  return (
    <>
      <RootStack />
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
