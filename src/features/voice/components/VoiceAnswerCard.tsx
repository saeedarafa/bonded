import { Linking, Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Button, Icon, Text, useTheme } from '@/ui';

import { formatVoiceTime, VOICE_ANSWER_MAX_MS } from '../encoding';
import type { useVoiceRecorder } from '../useVoiceRecorder';
import { VoiceNote } from './VoiceNote';

type Recorder = ReturnType<typeof useVoiceRecorder>;

/** The gold "Premium" word (D41: Premium is always named, never shown by colour alone). */
export function PremiumWord({ testID }: { testID?: string }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        paddingHorizontal: space.sm + 2,
        minHeight: 24,
        justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor: colors.premiumTint,
      }}
    >
      <Text variant="caption" style={{ color: colors.premiumText, fontWeight: '600' }}>
        {t('voice.switch.premium')}
      </Text>
    </View>
  );
}

function TextAction({
  label,
  a11y,
  icon,
  color,
  onPress,
  testID,
}: {
  label: string;
  a11y: string;
  icon: 'mic' | 'trash';
  color: string;
  onPress: () => void;
  testID: string;
}) {
  const { space } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, minHeight: 44 }}
    >
      <Icon name={icon} size={16} color={color} />
      <Text variant="label" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 19c Record a voice answer (D46). The board draws the recorded state (play, record again,
 * delete); idle, recording and microphone-off are neutral placeholders (docs/design/GAPS.md).
 */
export function VoiceAnswerCard({ recorder }: { recorder: Recorder }) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const max = formatVoiceTime(VOICE_ANSWER_MAX_MS);
  const elapsed = formatVoiceTime(recorder.elapsedMs);

  let content;
  if (recorder.phase === 'recorded' && recorder.take) {
    content = (
      <>
        <VoiceNote
          testID="19c-preview"
          source={{ uri: recorder.take.fileUri }}
          durationMs={recorder.take.durationMs}
          isMe
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <TextAction
            testID="19c-record-again"
            icon="mic"
            color={colors.youText}
            label={t('voice.answer.recordAgain')}
            a11y={t('voice.answer.recordAgain')}
            onPress={() => void recorder.start()}
          />
          <TextAction
            testID="19c-delete"
            icon="trash"
            color={colors.blushText}
            label={t('voice.answer.delete')}
            a11y={t('voice.answer.deleteA11y')}
            onPress={recorder.discard}
          />
        </View>
        {recorder.autoStopped ? (
          <Text variant="caption" tone="text2" testID="19c-auto-stopped">
            {t('voice.answer.autoStopped')}
          </Text>
        ) : null}
      </>
    );
  } else if (recorder.phase === 'recording') {
    content = (
      <>
        <Text
          variant="label"
          style={{ fontVariant: ['tabular-nums'] }}
          testID="19c-timer"
          accessibilityLabel={t('voice.answer.recording', { time: elapsed, max })}
        >
          {t('voice.answer.recording', { time: elapsed, max })}
        </Text>
        <Button
          testID="19c-stop"
          icon="stop"
          label={t('voice.answer.stop')}
          accessibilityHint={t('voice.answer.stopA11y', { time: elapsed })}
          onPress={() => void recorder.stop()}
        />
      </>
    );
  } else {
    content = (
      <Button
        testID="19c-record"
        variant="ghost"
        icon="mic"
        label={t('voice.answer.record')}
        accessibilityHint={t('voice.answer.recordA11y')}
        loading={recorder.phase === 'starting'}
        onPress={() => void recorder.start()}
      />
    );
  }

  return (
    <View
      testID="19c-card"
      style={{
        gap: space.md,
        paddingVertical: space.md + 2,
        paddingHorizontal: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="label" style={{ flex: 1 }} accessibilityRole="header">
          {t('voice.answer.title')}
        </Text>
        <PremiumWord />
      </View>
      {content}
      {recorder.denied ? (
        <View style={{ gap: space.xs }} testID="19c-mic-denied">
          <Text variant="caption" tone="text2">
            {t('voice.mic.denied')}
          </Text>
          <Button
            testID="19c-open-settings"
            variant="link"
            label={t('voice.mic.openSettings')}
            onPress={() => void Linking.openSettings()}
          />
        </View>
      ) : null}
      {recorder.failed ? (
        <Text variant="caption" style={{ color: colors.blushText }} testID="19c-failed">
          {t('voice.answer.failed')}
        </Text>
      ) : null}
      <Text variant="caption" tone="text2">
        {t('voice.answer.hint')}
      </Text>
    </View>
  );
}
