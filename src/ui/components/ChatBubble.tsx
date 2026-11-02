import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from '../Text';
import { personColors } from '../theme';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

export type MessageStatus = 'sent' | 'sending' | 'failed';

type Props = {
  /** `message.user_id === session.user.id`. Mine: orange tint, right. Partner's: sky tint, left. */
  isMe: boolean;
  text: string;
  /** Screen-reader sender, e.g. "You" or "Sam" (from t()). */
  senderName: string;
  /** "21:04". */
  time?: string;
  status?: MessageStatus;
  /** "Sending…" / "Not sent. Tap to retry" (from t()); shown for sending and failed. */
  statusLabel?: string;
  /** Retry a failed send (reuse the same `client_id`, so a duplicate is impossible). */
  onRetry?: () => void;
  testID?: string;
};

/** Pops in once (200 ms) when it first appears; no animation with reduced motion. */
export function ChatBubble({
  isMe,
  text,
  senderName,
  time,
  status = 'sent',
  statusLabel,
  onRetry,
  testID,
}: Props) {
  const { colors, radius, space, motion } = useTheme();
  const reduced = useReducedMotion();
  const pc = personColors(colors, isMe);
  const appear = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) appear.value = withTiming(1, { duration: motion.duration.fast });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animated = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ scale: 0.96 + 0.04 * appear.value }],
  }));

  const failed = status === 'failed';
  const label = [senderName, text, time, statusLabel].filter(Boolean).join(', ');

  return (
    <Animated.View
      style={[{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '82%', gap: 2 }, animated]}
    >
      <View
        testID={testID}
        accessible
        accessibilityLabel={label}
        style={{
          paddingHorizontal: space.lg - 2,
          paddingVertical: space.md - 1,
          backgroundColor: pc.tint,
          borderRadius: 18,
          borderBottomRightRadius: isMe ? radius.tile - 1 : 18,
          borderBottomLeftRadius: isMe ? 18 : radius.tile - 1,
          opacity: status === 'sending' ? 0.7 : 1,
        }}
      >
        <Text variant="body">{text}</Text>
      </View>
      {status !== 'sent' && statusLabel ? (
        failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={statusLabel}
            onPress={onRetry}
            style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' }}
          >
            <Text variant="caption" tone="blushText">
              {statusLabel}
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="text3" style={{ alignSelf: 'flex-end' }}>
            {statusLabel}
          </Text>
        )
      ) : null}
    </Animated.View>
  );
}
