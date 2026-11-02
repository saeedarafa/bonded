import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { useTranslation } from '@/i18n';
import { Banner, Button, Skeleton, SkeletonGroup, useTheme } from '@/ui';

/**
 * The front door (MOB-08). Signed out: onboarding. Signed in: Today once there is a couple, the
 * invite step while there isn't one yet (MOB-07 puts `create_couple` in front of it). The couple
 * comes from the persisted query cache first, so a returning person on a plane still gets in.
 */
export default function Index() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status } = useSession();
  const couple = useActiveCouple({ enabled: status === 'signedIn' });

  if (status !== 'signedIn') return <Redirect href="/welcome" />;
  if (couple.data) return <Redirect href="/today" />;
  if (couple.data === null) return <Redirect href="/invite" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="index-loading">
      <View style={{ flex: 1, padding: space.gutter, gap: space.lg, justifyContent: 'center' }}>
        {couple.error ? (
          <>
            <Banner tone="error" message={couple.error.message} />
            <Button label={t('ui.retry')} onPress={() => void couple.refetch()} />
          </>
        ) : (
          <SkeletonGroup>
            <Skeleton height={32} width="60%" />
            <Skeleton height={120} />
          </SkeletonGroup>
        )}
      </View>
    </SafeAreaView>
  );
}
