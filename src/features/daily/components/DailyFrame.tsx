import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import type { AppError } from '@/lib/errors';
import { Banner, Button, OfflineBanner, Skeleton, SkeletonGroup, TopBar, useTheme } from '@/ui';

type Props = {
  testID: string;
  onBack: () => void;
  title?: string;
  center?: ReactNode;
  right?: ReactNode;
  /** Pinned under the scrolling content (the main action). */
  footer?: ReactNode;
  children: ReactNode;
};

/** Screens 19 to 21: top bar, offline banner, scrolling body (grows with 200% text), pinned action. */
export function DailyFrame({ testID, onBack, title, center, right, footer, children }: Props) {
  const { colors, space } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={testID}>
      <OfflineBanner />
      <TopBar
        onBack={onBack}
        testID={`${testID}-top`}
        {...(title ? { title } : {})}
        {...(center ? { center } : {})}
        {...(right ? { right } : {})}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, gap: space.lg, padding: space.gutter }}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={{ paddingHorizontal: space.gutter, paddingBottom: space.lg, gap: space.sm }}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function DailyLoading({ testID }: { testID: string }) {
  return (
    <SkeletonGroup testID={testID}>
      <Skeleton height={64} />
      <Skeleton height={180} />
      <Skeleton height={56} />
    </SkeletonGroup>
  );
}

export function DailyError({
  error,
  fallback,
  onRetry,
  testID,
}: {
  error: AppError;
  fallback: string;
  onRetry: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <View style={{ gap: space.lg }} testID={testID}>
      <Banner tone="error" message={error.message || fallback} />
      <Button label={t('ui.retry')} onPress={onRetry} />
    </View>
  );
}
