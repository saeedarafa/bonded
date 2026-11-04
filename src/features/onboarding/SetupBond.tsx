import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { isKeyDatesWriteError, useSetupBond } from '@/features/onboarding/hooks';
import { useTranslation } from '@/i18n';
import { Banner, Button, Mascot, Text, useTheme } from '@/ui';

/**
 * Between sign-in and the invite step (BE-03): writes the onboarding answers (`create_couple`,
 * profile name, key dates), then the reminder primer (09, which steps aside to the invite once asked). Shown by the front door while the signed-in person has
 * no couple. A failure keeps the answers and offers "Try again"; a failed key-dates write also offers to go on
 * without the dates.
 */
export function SetupBond() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { userId } = useSession();
  const setup = useSetupBond();
  const started = useRef(false);

  const { mutate } = setup;
  const run = (skipKeyDates = false) => {
    if (!userId) return;
    mutate({ userId, skipKeyDates }, { onSuccess: () => router.replace('/reminders') });
  };
  const datesFailed = isKeyDatesWriteError(setup.error);

  useEffect(() => {
    if (started.current || !userId) return;
    started.current = true;
    mutate({ userId }, { onSuccess: () => router.replace('/reminders') });
  }, [userId, mutate, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="setup-bond">
      <View style={{ flex: 1, padding: space.gutter, gap: space.lg, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', gap: space.md }}>
          <Mascot mood="saving-a-seat" size={140} />
          <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('onboarding.settingUp')}
          </Text>
        </View>
        {setup.error ? (
          <>
            <Banner
              tone="error"
              message={
                datesFailed
                  ? t('keyDates.notSaved', { reason: setup.error.message })
                  : setup.error.message
              }
              testID="setup-error"
            />
            <Button testID="setup-retry" label={t('ui.retry')} onPress={() => run()} />
            {datesFailed ? (
              // MOB-28: the dates are optional, so a refused write never traps the person here.
              <Button
                testID="setup-skip-dates"
                variant="ghost"
                label={t('keyDates.continueWithout')}
                onPress={() => run(true)}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
