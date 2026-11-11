import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';

import { Avatar } from './Avatar';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { personColors } from '../theme';
import { useTheme } from '../ThemeProvider';

type Props = {
  name: string;
  /** Whose initial the avatar shows when `name` is a label such as "You" (default: `name`). */
  avatarName?: string;
  /** `row.user_id === session.user.id`. Decides orange vs sky; never anything else. */
  isMe: boolean;
  /** "21:04". */
  time?: string;
  /** The answer text. Omit while `locked`: a locked answer is never fetched (RLS), so there is nothing to show. */
  body?: string;
  /** Shown instead of `body` (D46: a voice answer's player). */
  media?: ReactNode;
  /** Partner answer not unlocked yet (before both have answered). */
  locked?: boolean;
  /** Text (and screen-reader label) of a locked card when it isn't the reveal rule (D55: Premium). */
  lockedText?: string;
  lockedLabel?: string;
  /** Shown after the locked text (D55: the "Premium" word, D41). */
  lockedTag?: ReactNode;
  /** Reactions or other actions under the text. */
  children?: ReactNode;
  testID?: string;
};

/** One person's answer. Full text always shown, wrapped, never truncated. */
export function AnswerCard({
  name,
  avatarName,
  isMe,
  time,
  body,
  media,
  locked = false,
  lockedText,
  lockedLabel,
  lockedTag,
  children,
  testID,
}: Props) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const pc = personColors(colors, isMe);

  return (
    <View
      testID={testID}
      accessible={locked}
      accessibilityLabel={
        locked ? (lockedLabel ?? lockedText ?? t('ui.answerLocked', { name })) : undefined
      }
      style={{
        gap: space.sm + 2,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: locked ? colors.surface2 : colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Avatar name={avatarName ?? name} isMe={isMe} size="sm" />
        <Text variant="label" style={{ flex: 1, color: pc.text }}>
          {name}
        </Text>
        {time ? (
          <Text variant="caption" tone="text3" style={{ fontVariant: ['tabular-nums'] }}>
            {time}
          </Text>
        ) : null}
      </View>
      {locked ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="lock" size={16} color={colors.text3} />
          <Text variant="caption" tone="text3" style={{ flex: 1 }}>
            {lockedText ?? t('ui.answerLocked', { name })}
          </Text>
          {lockedTag}
        </View>
      ) : (
        (media ?? <Text variant="body">{body}</Text>)
      )}
      {children}
    </View>
  );
}
