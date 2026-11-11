import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Icon, Text, useTheme } from '@/ui';

import { PremiumWord } from './VoiceAnswerCard';

export type AnswerMode = 'write' | 'voice';

type Props = {
  mode: AnswerMode;
  onChange: (mode: AnswerMode) => void;
  /** Free couple (D46): the Voice tab carries the word "Premium" and opens the paywall instead. */
  voiceLocked: boolean;
  onLockedVoice: () => void;
};

/** The "Write | Voice" switch on 19 / 19b / 19c / 19d (S04, D46). Two 44 pt tabs. */
export function AnswerTypeSwitch({ mode, onChange, voiceLocked, onLockedVoice }: Props) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();

  const tab = (id: AnswerMode) => {
    const selected = mode === id;
    const locked = id === 'voice' && voiceLocked;
    return (
      <Pressable
        key={id}
        testID={`19-tab-${id}`}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={locked ? t('voice.switch.voiceFreeA11y') : t(`voice.switch.${id}`)}
        onPress={() => (locked ? onLockedVoice() : onChange(id))}
        style={{
          flex: 1,
          minHeight: 44,
          borderRadius: radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.xs + 2,
          paddingHorizontal: space.sm,
          backgroundColor: selected ? colors.surface : 'transparent',
          borderWidth: selected ? 1 : 0,
          borderColor: colors.line,
        }}
      >
        {locked ? <Icon name="mic" size={16} color={colors.text2} /> : null}
        <Text variant="label" style={{ color: selected ? colors.text : colors.text2 }}>
          {t(`voice.switch.${id}`)}
        </Text>
        {locked ? <PremiumWord testID="19-voice-premium" /> : null}
      </Pressable>
    );
  };

  return (
    <View
      testID="19-switch"
      accessibilityRole="tablist"
      accessibilityLabel={t('voice.switch.label')}
      style={{
        flexDirection: 'row',
        gap: space.xs,
        padding: space.xs,
        borderRadius: radius.pill,
        backgroundColor: colors.surface2,
      }}
    >
      {tab('write')}
      {tab('voice')}
    </View>
  );
}
