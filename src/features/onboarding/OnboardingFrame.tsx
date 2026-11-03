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
import { keyboardBehavior } from '@/features/daily/components/DailyFrame';
import { ProgressBar, Text, TopBar, useCramped, useFocusedFieldInView, useTheme } from '@/ui';

type Props = {
  /** Screen id from screens.json; the root gets `testID="<id>-screen"`. */
  screenId: string;
  /** Quiz progress: step n of total (sign-in is the last step). Omit for the story screens. */
  step?: { n: number; total: number };
  onBack?: () => void;
  children: ReactNode;
  /** Pinned under the scroll area: the primary button and its hint. */
  footer?: ReactNode;
  /** Centre the content vertically (welcome). */
  centered?: boolean;
};

/** Shared frame for onboarding screens 01 to 07: top bar (+ progress), scrolling body, pinned footer. */
export function OnboardingFrame({ screenId, step, onBack, children, footer, centered }: Props) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const keyboard = keyboardBehavior(Platform.OS);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // #66: the field being typed in stays visible, Continue stays above the keyboard, and the
  // keyboard closes on a tap outside a field or a drag (as on 19/J7, #32).
  const followFocus = useFocusedFieldInView(scroll, space.md);
  const inline = useCramped();
  const action = footer ? (
    <View
      testID={`${screenId}-footer`}
      style={{
        gap: space.md,
        paddingHorizontal: space.gutter,
        paddingTop: space.md,
        paddingBottom: space.lg,
      }}
    >
      {footer}
    </View>
  ) : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID={`${screenId}-screen`}>
      {step ? (
        <TopBar
          testID={`${screenId}-top`}
          onBack={onBack}
          center={
            <ProgressBar
              testID={`${screenId}-progress`}
              value={step.n / step.total}
              label={t('ui.stepOf', { step: step.n, total: step.total })}
            />
          }
          right={
            <Text variant="caption" tone="text2" importantForAccessibility="no-hide-descendants">
              {t('ui.stepCount', { step: step.n, total: step.total })}
            </Text>
          }
        />
      ) : onBack ? (
        <TopBar testID={`${screenId}-top`} onBack={onBack} />
      ) : null}
      <KeyboardAvoidingView
        testID={`${screenId}-keyboard`}
        style={{ flex: 1 }}
        behavior={keyboard.behavior}
      >
        <ScrollView
          ref={scroll}
          {...followFocus}
          testID={`${screenId}-scroll`}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={keyboard.dismissMode}
        >
          <Pressable
            testID={`${screenId}-dismiss`}
            accessible={false}
            onPress={Keyboard.dismiss}
            style={{
              flexGrow: 1,
              justifyContent: centered ? 'center' : 'flex-start',
              gap: space.xl,
              paddingHorizontal: space.gutter,
              paddingTop: space.xl,
              paddingBottom: space.xl,
            }}
          >
            {children}
          </Pressable>
          {inline ? action : null}
        </ScrollView>
        {inline ? null : action}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
