import { useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { keyboardBehavior } from '@/features/daily/components/DailyFrame';
import { manageSubscriptionsUrl } from '@/features/premium/purchases';
import { useTranslation } from '@/i18n';
import {
  Banner,
  Button,
  haptics,
  OfflineBanner,
  Text,
  TextField,
  TopBar,
  useFocusedFieldInView,
  useTheme,
  useToast,
} from '@/ui';

import { useDeleteAccount, usePairNames } from '../hooks';
import { DELETE_WORD, isDeleteConfirmed } from '../model';

/**
 * 43 Delete account (required by Apple and Google). Type DELETE, then "Delete forever" calls the
 * `delete-account` function; on success everything local is wiped and the auth gate shows
 * onboarding. A wrong word or a failed call is said inline; nothing is deleted until the server
 * says so, and "deleted" is only said when it did (a 401 Auth can't confirm ends as signed out) (D09: the partner keeps their own answers for 30 days and sees 58).
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const followFocus = useFocusedFieldInView(scroll, space.md);
  const showToast = useToast((s) => s.show);
  const { partner } = usePairNames();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = () => {
    if (remove.isPending) return;
    if (!isDeleteConfirmed(typed)) {
      // TextField shakes and buzzes on the new error.
      setFieldError(t('settings.delete.wrong'));
      return;
    }
    setFieldError(null);
    remove.mutate(undefined, {
      onSuccess: (outcome) =>
        showToast(
          t(outcome === 'deleted' ? 'settings.delete.deleted' : 'settings.delete.signedOut'),
        ),
      onError: () => haptics.error(),
    });
  };

  const bullets = [
    t('settings.delete.bulletData'),
    t('settings.delete.bulletPartner', { partner }),
    t('settings.delete.bulletBilling'),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="43-screen">
      <OfflineBanner />
      <TopBar onBack={() => router.back()} testID="43" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={keyboardBehavior(Platform.OS).behavior}>
        <ScrollView
          ref={scroll}
          {...followFocus}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            paddingHorizontal: space.gutter,
            paddingTop: space.sm,
            paddingBottom: space.xl,
            gap: space.xl,
          }}
        >
          <View style={{ gap: space.lg + 2 }}>
            <Text variant="h1" accessibilityRole="header">
              {t('settings.delete.title')}
            </Text>
            <View style={{ gap: space.md }} testID="43-bullets">
              {bullets.map((text, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: space.sm + 2 }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: radius.pill,
                      marginTop: space.sm + 1,
                      backgroundColor: colors.blush,
                    }}
                  />
                  <Text tone="text2" style={{ flex: 1 }}>
                    {text}
                    {i === 2 ? (
                      <>
                        {' '}
                        <Text
                          testID="43-manage"
                          accessibilityRole="link"
                          style={{ textDecorationLine: 'underline' }}
                          onPress={() =>
                            void Linking.openURL(manageSubscriptionsUrl(Platform.OS)).catch(
                              () => {},
                            )
                          }
                        >
                          {t('settings.delete.manage')}
                        </Text>
                      </>
                    ) : null}
                  </Text>
                </View>
              ))}
            </View>
            <TextField
              testID="43-input"
              label={t('settings.delete.typeLabel')}
              showLabel
              value={typed}
              onChangeText={(v) => {
                setTyped(v);
                if (fieldError) setFieldError(null);
              }}
              placeholder={DELETE_WORD}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="done"
              onSubmitEditing={submit}
              error={fieldError}
            />
            {remove.error ? (
              <Banner tone="error" message={remove.error.message} testID="43-error" />
            ) : null}
          </View>
          <View style={{ gap: space.xs }}>
            <Button
              testID="43-confirm"
              variant="destructive"
              label={t('settings.delete.confirm')}
              loading={remove.isPending}
              onPress={submit}
            />
            <Button
              testID="43-keep"
              variant="link"
              label={t('settings.delete.keep')}
              onPress={() => router.back()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
