import { useEffect, useState, type ReactNode } from 'react';
import { Dimensions, Keyboard, Modal, Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

type Props = {
  visible: boolean;
  /**
   * Scrim tap, the Android back button, the swipe gesture, the VoiceOver escape (two-finger scrub)
   * and the close action all call this.
   */
  onDismiss: () => void;
  title?: string;
  children: ReactNode;
  testID?: string;
  /**
   * Default true: the content scrolls inside the sheet. False for content that scrolls itself
   * (a virtualized list, e.g. the emoji picker): it gets the space left under the title.
   */
  scroll?: boolean;
};

/**
 * Bottom sheet: 32 radius, grab handle, 40% scrim. Slides up in 300 ms (fades in with reduced
 * motion). Content scrolls if it doesn't fit, so 200% text is never cut off.
 */
export function Sheet({ visible, onDismiss, title, children, testID, scroll = true }: Props) {
  return (
    <Modal
      testID="sheet-modal"
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <SheetBody onDismiss={onDismiss} title={title} testID={testID} scroll={scroll}>
        {children}
      </SheetBody>
    </Modal>
  );
}

/**
 * MOB-86: how far the keyboard reaches up from the window bottom. Android (edge-to-edge) reports
 * the keyboard height without the navigation bar under it, so the sheet's Save button sat 24 dp
 * behind the keyboard; the keyboard's top edge (`screenY`) is exact on both platforms.
 */
export function keyboardLift(
  frame: { height: number; screenY: number },
  windowHeight: number,
): number {
  return Math.max(0, frame.height, windowHeight - frame.screenY);
}

/**
 * MOB-83: the sheet lives in its own Modal window, so the screen's keyboard handling never reaches
 * it: a text field in a sheet (names, emoji search) and its Save button sat behind the keyboard.
 * Height of the keyboard over the window bottom while it is open, else 0.
 */
function useKeyboardLift(): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setLift(keyboardLift(e.endCoordinates, Dimensions.get('window').height)),
    );
    const frame = Keyboard.addListener('keyboardDidChangeFrame', (e) =>
      setLift(
        Keyboard.isVisible() ? keyboardLift(e.endCoordinates, Dimensions.get('window').height) : 0,
      ),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setLift(0));
    return () => {
      show.remove();
      frame.remove();
      hide.remove();
    };
  }, []);
  return lift;
}

function SheetBody({ onDismiss, title, children, testID, scroll }: Omit<Props, 'visible'>) {
  const { t } = useTranslation();
  const { colors, radius, space, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const enter = useSharedValue(reduced ? 1 : 0);
  const lift = useKeyboardLift();

  useEffect(() => {
    if (!reduced) enter.value = withTiming(1, { duration: motion.duration.base });
  }, [reduced, enter, motion.duration.base]);

  const panel = useAnimatedStyle(() => ({
    opacity: reduced ? enter.value : 1,
    transform: [{ translateY: reduced ? 0 : (1 - enter.value) * 400 }],
  }));

  return (
    <View
      style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: lift }}
      accessibilityViewIsModal
      // VoiceOver's two-finger scrub; a transparent Modal does not close on it by itself (MOB-25).
      onAccessibilityEscape={onDismiss}
      testID={testID}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ui.close')}
        onPress={onDismiss}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.scrim,
        }}
      />
      <Animated.View
        style={[
          {
            maxHeight: lift > 0 ? '100%' : '90%',
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: colors.line,
            paddingTop: space.md,
            paddingHorizontal: space.lg,
            paddingBottom: lift > 0 ? space.lg : Math.max(insets.bottom, space.lg),
          },
          panel,
        ]}
      >
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            alignSelf: 'center',
            width: 36,
            height: 5,
            borderRadius: 3,
            backgroundColor: colors.line,
            marginBottom: space.md,
          }}
        />
        {title ? (
          <Text variant="h2" accessibilityRole="header" style={{ marginBottom: space.md }}>
            {title}
          </Text>
        ) : null}
        {scroll ? (
          <ScrollView contentContainerStyle={{ gap: space.md }} bounces={false}>
            {children}
          </ScrollView>
        ) : (
          <View style={{ flexShrink: 1, gap: space.md }}>{children}</View>
        )}
      </Animated.View>
    </View>
  );
}
