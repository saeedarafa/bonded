import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Button, haptics, Icon, Sheet, Text, useTheme } from '@/ui';

/** Minutes move in 5s (any `HH:MM` is valid server-side; 5 keeps the stepper short). */
export const MINUTE_STEP = 5;

export function parseTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':').map(Number);
  return { hour: Number.isFinite(h) ? h! : 21, minute: Number.isFinite(m) ? m! : 0 };
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Wraps around: 23 + 1 = 0, 0 − 5 min = 55. */
export function stepTime(
  value: { hour: number; minute: number },
  part: 'hour' | 'minute',
  delta: 1 | -1,
): { hour: number; minute: number } {
  if (part === 'hour') return { ...value, hour: (value.hour + delta + 24) % 24 };
  const minute = Math.round(value.minute / MINUTE_STEP) * MINUTE_STEP + delta * MINUTE_STEP;
  return { ...value, minute: ((minute % 60) + 60) % 60 };
}

type Props = {
  visible: boolean;
  /** `HH:MM` to start from (read when the sheet mounts: render it only while open). */
  initial: string;
  onDismiss: () => void;
  onPick: (time: string) => void;
};

/**
 * N "Pick another time": a small 24-hour picker in a sheet (no native date-time module, so no new
 * dev build). Hour and minute are each an adjustable control: VoiceOver/TalkBack swipe up/down,
 * everyone else taps − / +. Undesigned (GAPS N).
 */
export function TimePickerSheet({ visible, initial, onDismiss, onPick }: Props) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const [value, setValue] = useState(() => parseTime(initial));
  const time = formatTime(value.hour, value.minute);

  const move = (part: 'hour' | 'minute', delta: 1 | -1) => {
    haptics.selection();
    setValue((v) => stepTime(v, part, delta));
  };

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('onboarding.moment.picker.title')}
      testID="N-picker"
    >
      <View style={{ gap: space.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
          <Stepper
            testID="N-picker-hour"
            label={t('onboarding.moment.picker.hour')}
            value={String(value.hour).padStart(2, '0')}
            onStep={(d) => move('hour', d)}
          />
          <Stepper
            testID="N-picker-minute"
            label={t('onboarding.moment.picker.minute')}
            value={String(value.minute).padStart(2, '0')}
            onStep={(d) => move('minute', d)}
          />
        </View>
        <Button
          testID="N-picker-use"
          label={t('onboarding.moment.picker.use', { time })}
          onPress={() => onPick(time)}
        />
      </View>
    </Sheet>
  );
}

function Stepper({
  label,
  value,
  onStep,
  testID,
}: {
  label: string;
  value: string;
  onStep: (delta: 1 | -1) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onStep(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={{ alignItems: 'center', gap: space.sm }}
    >
      <Text variant="caption" tone="text2">
        {label}
      </Text>
      <StepButton
        testID={`${testID}-up`}
        rotate="-90deg"
        label={`${t('onboarding.moment.picker.later')}, ${label}`}
        onPress={() => onStep(1)}
      />
      <View
        style={{
          minWidth: 88,
          alignItems: 'center',
          paddingVertical: space.md,
          borderRadius: radius.input,
          backgroundColor: colors.surface2,
        }}
      >
        <Text testID={`${testID}-value`} variant="number">
          {value}
        </Text>
      </View>
      <StepButton
        testID={`${testID}-down`}
        rotate="90deg"
        label={`${t('onboarding.moment.picker.earlier')}, ${label}`}
        onPress={() => onStep(-1)}
      />
    </View>
  );
}

/** A chevron pointing up (later) or down (earlier). */
function StepButton({
  label,
  onPress,
  testID,
  rotate,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  rotate: '-90deg' | '90deg';
}) {
  const { colors, radius, size } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size.tapTarget,
        height: size.tapTarget,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ transform: [{ rotate }] }}>
        <Icon name="chevron" size={20} color={colors.text} />
      </View>
    </Pressable>
  );
}
