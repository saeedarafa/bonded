import { useRef, type ComponentRef, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import type { AppError } from '@/lib/errors';
import {
  Banner,
  Button,
  KeepInViewProvider,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  TITLE_MAX_FONT_SCALE,
  TopBar,
  useCramped,
  useFocusedFieldInView,
  useKeepInViewGroups,
  useTheme,
} from '@/ui';

type Props = {
  testID: string;
  onBack: () => void;
  title?: string;
  center?: ReactNode;
  right?: ReactNode;
  /** Pinned under the scrolling content (the main action). */
  footer?: ReactNode;
  /** What the offline banner says on this screen (default: the generic line). */
  offlineMessage?: string;
  children: ReactNode;
};

/**
 * #32: how the keyboard behaves around the body and the pinned action. iOS pads the view above the
 * keyboard and lets a drag pull it down; Android already resizes the window, so no padding (it would
 * be counted twice) and a drag closes it.
 */
export function keyboardBehavior(os: typeof Platform.OS) {
  return os === 'ios'
    ? ({ behavior: 'padding', dismissMode: 'interactive' } as const)
    : ({ behavior: undefined, dismissMode: 'on-drag' } as const);
}

/** Screens 19 to 21: top bar, offline banner, scrolling body (grows with 200% text), pinned action. */
export function DailyFrame({
  testID,
  onBack,
  title,
  center,
  right,
  footer,
  offlineMessage,
  children,
}: Props) {
  const { colors, space } = useTheme();
  const keyboard = keyboardBehavior(Platform.OS);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // #65: the field being edited scrolls into view above the pinned action when the keyboard opens.
  // #85: a `KeepInView` group (field + counter + privacy line) scrolls into view as a whole.
  const groups = useKeepInViewGroups();
  const followFocus = useFocusedFieldInView(scroll, space.md, groups);
  // #65: on a short screen at a large text size the action scrolls with the body (it took half
  // the screen when pinned: 19's field started under it, 20's body was 125 pt).
  const inline = useCramped();
  // #84: the pinned title took the top 60% of an SE at AX5 (the field was invisible while typing).
  // Cramped, it scrolls with the body and only the back button stays pinned.
  const pinnedTitle = inline ? undefined : title;
  const action = footer ? (
    <View
      testID={`${testID}-footer`}
      style={{
        paddingHorizontal: space.gutter,
        paddingBottom: space.lg,
        gap: space.sm,
      }}
    >
      {footer}
    </View>
  ) : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={testID}>
      <OfflineBanner {...(offlineMessage ? { message: offlineMessage } : {})} />
      <TopBar
        onBack={onBack}
        testID={`${testID}-top`}
        {...(pinnedTitle ? { title: pinnedTitle } : {})}
        {...(center ? { center } : {})}
        {...(right ? { right } : {})}
      />
      {/*
        #32: on a small iPhone the keyboard covered the pinned action. The body and the action now
        shrink above the keyboard (padding on iOS; Android resizes the window), and the keyboard
        closes on a drag or on a tap anywhere outside the field.
      */}
      <KeyboardAvoidingView
        testID={`${testID}-keyboard`}
        style={{ flex: 1 }}
        behavior={keyboard.behavior}
      >
        <ScrollView
          ref={scroll}
          {...followFocus}
          testID={`${testID}-scroll`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={keyboard.dismissMode}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <Pressable
            testID={`${testID}-dismiss`}
            accessible={false}
            onPress={Keyboard.dismiss}
            style={{ flexGrow: 1, gap: space.lg, padding: space.gutter }}
          >
            {inline && title ? (
              <Text
                variant="h2"
                accessibilityRole="header"
                maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
                testID={`${testID}-title`}
              >
                {title}
              </Text>
            ) : null}
            <KeepInViewProvider value={groups}>{children}</KeepInViewProvider>
          </Pressable>
          {inline ? action : null}
        </ScrollView>
        {inline ? null : action}
      </KeyboardAvoidingView>
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
