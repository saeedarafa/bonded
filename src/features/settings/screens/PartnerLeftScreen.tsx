import { Redirect, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import { Button, Chip, Icon, Mascot, Skeleton, SkeletonGroup, Text, useTheme } from '@/ui';

import { useFormerPartnerName, usePartnerLeft } from '../hooks';
import { useEndedSeen } from '../partnerLeft';

/** MOB-27 builds the PDF export (P1); until then the card says it is coming. */
export const HISTORY_EXPORT_AVAILABLE = false;

/**
 * 58 Partner left: my partner unpaired or deleted their account (D08, D09), so the couple is
 * ended and I have no active one. Shown once per ended couple on this device; either action marks
 * it seen and goes back to `/`, which starts a fresh space (SetupBond, then 09/10).
 */
export default function PartnerLeftScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
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
          <View
            testID="58-download"
            accessible
            accessibilityLabel={[
              t('settings.partnerLeft.download'),
              t('settings.partnerLeft.downloadBody'),
              HISTORY_EXPORT_AVAILABLE ? null : t('settings.partnerLeft.downloadSoon'),
            ]
              .filter(Boolean)
              .join('. ')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.input - 4,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface2,
              }}
            >
              <Icon name="download" size={20} color={colors.text2} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label">{t('settings.partnerLeft.download')}</Text>
              <Text variant="caption" tone="text3">
                {t('settings.partnerLeft.downloadBody')}
              </Text>
            </View>
            {HISTORY_EXPORT_AVAILABLE ? null : (
              <Chip label={t('settings.partnerLeft.downloadSoon')} />
            )}
          </View>
          <View style={{ gap: space.xs }}>
            <Button testID="58-invite" label={t('settings.partnerLeft.invite')} onPress={leave} />
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
