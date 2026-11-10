import { Redirect, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HistoryExportCard } from '@/features/history/components/HistoryExportCard';
import { isEndedHistoryOpen } from '@/features/history/ended';
import { useTranslation } from '@/i18n';
import { Button, Mascot, Skeleton, SkeletonGroup, Text, useTheme } from '@/ui';

import { useFormerPartnerName, usePartnerLeft } from '../hooks';
import { useEndedSeen } from '../partnerLeft';

/**
 * 58 Partner left: my partner unpaired or deleted their account (D08, D09), so the couple is
 * ended and I have no active one. Shown once per ended couple on this device; either action marks
 * it seen and goes back to `/`, which starts a fresh space (SetupBond, then 09/10). "Read your
 * History" (MOB-50) opens the ended couple's read-only History and "Download your history"
 * (MOB-27) makes its PDF, both only while its 30 days last.
 */
export default function PartnerLeftScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { couple } = usePartnerLeft({ enabled: true });
  const name = useFormerPartnerName(couple);
  const markSeen = useEndedSeen((s) => s.markSeen);

  if (couple === null) return <Redirect href="/" />;

  const partner = name.data || t('pairing.partnerFallback');
  const leave = () => {
    if (couple) markSeen(couple.id);
    router.replace('/');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="58-screen">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          paddingHorizontal: space.gutter,
          paddingTop: space.hero,
          paddingBottom: space.xl,
          gap: space.xl,
        }}
      >
        {couple === undefined ? (
          <SkeletonGroup testID="58-loading">
            <Skeleton height={150} width={150} />
            <Skeleton height={32} />
          </SkeletonGroup>
        ) : (
          <View style={{ alignItems: 'center', gap: space.md + 2 }}>
            <Mascot
              mood="saving-a-seat"
              size={150}
              accessibilityLabel={t('settings.partnerLeft.mascot')}
            />
            <Text
              variant="h1"
              accessibilityRole="header"
              style={{ textAlign: 'center' }}
              testID="58-title"
            >
              {t('settings.partnerLeft.title', { partner })}
            </Text>
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {t('settings.partnerLeft.body')}
            </Text>
          </View>
        )}
        <View style={{ gap: space.xl }}>
          {couple && isEndedHistoryOpen(couple) ? (
            // MOB-27: the PDF of the archive, only while RLS still returns it (30 days).
            <HistoryExportCard couple={couple} testID="58-download" />
          ) : null}
          <View style={{ gap: space.xs }}>
            <Button testID="58-invite" label={t('settings.partnerLeft.invite')} onPress={leave} />
            {couple && isEndedHistoryOpen(couple) ? (
              // MOB-50: "saved in History for 30 days". 58 stays unseen, so back returns here.
              <Button
                testID="58-history"
                variant="ghost"
                label={t('settings.partnerLeft.history')}
                onPress={() => router.push('/ended')}
              />
            ) : null}
            <Button
              testID="58-not-now"
              variant="link"
              label={t('settings.partnerLeft.notNow')}
              onPress={leave}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
