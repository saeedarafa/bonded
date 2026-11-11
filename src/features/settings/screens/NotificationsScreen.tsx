import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { useLittleThingsSoundPref } from '@/features/littleThings/hooks';
import { SHIPPED } from '@/features/premium/features';
import { getPermission, type PermissionState } from '@/features/push/device';
import { useAcceptSoftAsk } from '@/features/push/hooks';
import { shortTime } from '@/features/push/ritual';
import { useTranslation } from '@/i18n';
import {
  Banner,
  Button,
  OfflineBanner,
  OptionRow,
  Sheet,
  Skeleton,
  SkeletonGroup,
  Text,
  TopBar,
  useTheme,
} from '@/ui';

import { DEFAULT_PREFS, PUSH_TOGGLES, type PushToggle } from '../api';
import { SettingsGroup, SettingsRow, SettingsToggleRow } from '../components/SettingsList';
import { useNotificationPrefs, usePairNames, useSaveNotificationPrefs } from '../hooks';
import { QUIET_PRESETS, quietKey, quietLabel } from '../model';

/** The OS permission, re-read on focus and when the app comes back from the system settings. */
function usePermission(): { state: PermissionState | null; refresh: () => void } {
  const [state, setState] = useState<PermissionState | null>(null);
  const read = useCallback(() => {
    void getPermission()
      .then(setState)
      .catch(() => setState(null));
  }, []);
  useFocusEffect(read);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') read();
    });
    return () => sub.remove();
  }, [read]);
  return { state, refresh: read };
}

/**
 * 41 Notification settings: one switch per push type (D23) and quiet hours (D24), saved to
 * `notification_prefs` at once (optimistic, rolled back with a message on failure). When the OS
 * permission is off, a card says so and opens the system settings; the switches stay editable.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { userId } = useSession();
  const { partner } = usePairNames();
  const prefs = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const { state: osState, refresh: refreshPermission } = usePermission();
  const turnOn = useAcceptSoftAsk();
  const [quietOpen, setQuietOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sound = useLittleThingsSoundPref();
  // D27: the little-things rows only once the feature ships.
  const toggles = PUSH_TOGGLES.filter((key) => key !== 'little_things' || SHIPPED.littleThings);

  const values = prefs.data ?? DEFAULT_PREFS;
  const ritual = shortTime(values.ritual_time);

  const change = (patch: Parameters<typeof save.mutate>[0]) => {
    setError(null);
    save.mutate(patch, { onError: () => setError(t('settings.notifications.saveError')) });
  };

  const describe = (key: PushToggle) =>
    t(`settings.notifications.${key}Body`, { time: ritual, partner });

  let body;
  if (prefs.error && prefs.data === undefined) {
    body = (
      <View style={{ gap: space.md }} testID="41-error">
        <Banner
          tone="error"
          message={prefs.error.message || t('settings.notifications.loadError')}
        />
        <Button label={t('ui.retry')} onPress={() => void prefs.refetch()} />
      </View>
    );
  } else if (prefs.data === undefined) {
    body = (
      <SkeletonGroup testID="41-loading">
        <Skeleton height={360} />
        <Skeleton height={52} />
      </SkeletonGroup>
    );
  } else {
    body = (
      <>
        <SettingsGroup testID="41-toggles">
          {toggles.flatMap((key) => {
            const row = (
              <SettingsToggleRow
                key={key}
                testID={`41-${key}`}
                label={t(`settings.notifications.${key}`, { partner })}
                description={describe(key)}
                value={values[key]}
                onValueChange={(next) => change({ [key]: next })}
              />
            );
            if (key !== 'little_things') return [row];
            // D53 / BE-53: in-app gesture sounds and the push sound (`little_things_sound`).
            return [
              row,
              <SettingsToggleRow
                key="little_things_sound"
                testID="41-little_things_sound"
                label={t('settings.notifications.little_things_sound')}
                description={t('settings.notifications.little_things_soundBody')}
                value={sound.on}
                onValueChange={(next) => {
                  setError(null);
                  sound.setOn(next, {
                    onError: () => setError(t('settings.notifications.saveError')),
                  });
                }}
              />,
            ];
          })}
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            testID="41-quiet"
            label={t('settings.notifications.quiet')}
            value={quietLabel(values.quiet_start, values.quiet_end)}
            chevron
            onPress={() => {
              setError(null);
              setQuietOpen(true);
            }}
          />
        </SettingsGroup>
      </>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="41-screen"
    >
      <OfflineBanner />
      <TopBar title={t('settings.notifications.title')} onBack={() => router.back()} testID="41" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: space.sm,
          paddingBottom: space.xl,
          gap: space.md,
        }}
      >
        {osState === 'denied' || osState === 'undetermined' ? (
          <View
            testID={`41-permission-${osState}`}
            style={{
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.card - 2,
              backgroundColor: colors.surface2,
            }}
          >
            <Text tone="text2">
              {osState === 'denied'
                ? t('settings.notifications.denied')
                : t('settings.notifications.undetermined')}
            </Text>
            {osState === 'denied' ? (
              <Button
                testID="41-open-settings"
                variant="ghost"
                label={t('settings.notifications.openSettings')}
                onPress={() => void Linking.openSettings().catch(() => {})}
              />
            ) : (
              <Button
                testID="41-turn-on"
                variant="ghost"
                label={t('settings.notifications.turnOn')}
                loading={turnOn.isPending}
                onPress={() =>
                  turnOn.mutate(
                    { userId: userId ?? '', ritualTime: ritual },
                    { onSettled: refreshPermission },
                  )
                }
              />
            )}
          </View>
        ) : null}
        {error ? <Banner tone="error" message={error} testID="41-save-error" /> : null}
        {body}
      </ScrollView>

      <Sheet
        visible={quietOpen}
        onDismiss={() => setQuietOpen(false)}
        title={t('settings.notifications.quiet')}
        testID="41-quiet-sheet"
      >
        <View style={{ gap: space.md }}>
          <Text tone="text2">{t('settings.notifications.quietBody')}</Text>
          {QUIET_PRESETS.map((p) => {
            const key = quietKey(p.start, p.end);
            return (
              <OptionRow
                key={key}
                testID={`41-quiet-${key}`}
                label={quietLabel(p.start, p.end)}
                selected={quietKey(values.quiet_start, values.quiet_end) === key}
                onPress={() => {
                  setQuietOpen(false);
                  change({ quiet_start: p.start, quiet_end: p.end });
                }}
              />
            );
          })}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
