import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { useTranslation } from '@/i18n';

import { haptics } from '../haptics';
import { Icon } from '../Icon';
import { useTheme } from '../ThemeProvider';

/** Thread messages are 1 to 2000 characters (CONTRACTS §8). */
export const MESSAGE_MAX_LENGTH = 2000;
/** D15: typing presence is sent at most every 3 s. */
export const TYPING_THROTTLE_MS = 3000;

type Props = {
  /** Called with the trimmed text. The caller owns the optimistic insert and the `client_id`. */
  onSend: (text: string) => void;
  /** Called at most every 3 s while the person types (broadcast presence, no database write). */
  onTyping?: () => void;
  placeholder?: string;
  testID?: string;
};

export function Composer({ onSend, onTyping, placeholder, testID }: Props) {
  const { t } = useTranslation();
  const { colors, type, radius, space, size } = useTheme();
  const [text, setText] = useState('');
  const lastTyping = useRef(0);
  const hasText = text.trim().length > 0;

  const change = (next: string) => {
    setText(next);
    if (next.trim() && onTyping) {
      const now = Date.now();
      if (now - lastTyping.current >= TYPING_THROTTLE_MS) {
        lastTyping.current = now;
        onTyping();
      }
    }
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    haptics.light();
    setText('');
    lastTyping.current = 0;
    onSend(body);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: space.sm,
        padding: space.sm,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <TextInput
        testID={testID}
        value={text}
        onChangeText={change}
        multiline
        maxLength={MESSAGE_MAX_LENGTH}
        placeholder={placeholder ?? t('ui.messagePlaceholder')}
        placeholderTextColor={colors.text3}
        selectionColor={colors.you}
        accessibilityLabel={placeholder ?? t('ui.messagePlaceholder')}
        style={[
          type.body,
          {
            flex: 1,
            minHeight: size.tapTarget,
            maxHeight: 120,
            color: colors.text,
            paddingHorizontal: space.sm,
            paddingVertical: space.sm,
          },
        ]}
      />
      <Pressable
        testID={testID && `${testID}-send`}
        accessibilityRole="button"
        accessibilityLabel={t('ui.send')}
        onPress={send}
        style={{
          width: size.tapTarget,
          height: size.tapTarget,
          borderRadius: size.tapTarget / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: hasText ? colors.you : colors.surface2,
        }}
      >
        <Icon name="send" color={hasText ? colors.onYou : colors.text3} />
      </Pressable>
    </View>
  );
}
