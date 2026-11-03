import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useDismissEmailLinkError, useEmailLinkError, useSession } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { Banner, Button, Skeleton, useTheme } from '@/ui';

/** SessionProvider consumes credentials, never the router screen or its query parameters. */
export default function EmailCallbackScreen() {
  const { status } = useSession();
  const error = useEmailLinkError();
  const dismissError = useDismissEmailLinkError();
  const pendingInviteCode = usePendingInvite((s) => s.code);
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const router = useRouter();

  if (status !== 'loading' && !error) return <Redirect href="/" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="08-email-callback">
      <View style={{ flex: 1, padding: space.gutter, gap: space.lg, justifyContent: 'center' }}>
        {status === 'loading' ? (
          <Skeleton height={space.xl} />
        ) : (
          <>
            <Banner tone="error" message={error!.message} />
            <Button
              label={t('auth.linkRetry')}
              onPress={() => {
                dismissError();
                router.replace(pendingInviteCode ? '/join/sign-in' : '/sign-in');
              }}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
