import { ActivityIndicator, Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Icon, personColors, Text, useTheme } from '@/ui';

import { formatVoiceTime } from '../encoding';
import { useVoicePlayback, type VoiceSource } from '../useVoicePlayback';

/** The board's 28 bars (S04 19c). Decorative: the time and the button carry the meaning. */
const BARS = [
  6, 12, 18, 10, 22, 16, 8, 14, 24, 20, 12, 6, 16, 22, 18, 10, 14, 26, 20, 12, 8, 16, 22, 14, 10,
  18, 12, 6,
];

type Props = {
  source: VoiceSource;
  durationMs: number;
  /** Orange for mine, sky for the partner's (always relative to the viewer). */
  isMe: boolean;
  testID?: string;
};

/**
 * One voice note: play / pause, progress bars and the time (19c preview, 21 revealed answers).
 * Screen readers hear "Play voice answer, 0:42". 44 pt button.
 */
export function VoiceNote({ source, durationMs, isMe, testID }: Props) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const pc = personColors(colors, isMe);
  const playback = useVoicePlayback(source);
  const time = formatVoiceTime(durationMs);
  const progress = durationMs > 0 ? Math.min(1, playback.positionMs / durationMs) : 0;
  const played = Math.round(progress * BARS.length);

  return (
    <View style={{ gap: space.xs }} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Pressable
          testID={testID && `${testID}-play`}
          accessibilityRole="button"
          accessibilityLabel={
            playback.playing ? t('voice.player.pauseA11y') : t('voice.player.playA11y', { time })
          }
          accessibilityState={{ busy: playback.loading }}
          onPress={() => void playback.toggle()}
          hitSlop={4}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pc.fill,
          }}
        >
          {playback.loading ? (
            <ActivityIndicator color={pc.on} />
          ) : (
            <Icon name={playback.playing ? 'pause' : 'play'} size={16} color={pc.on} filled />
          )}
        </Pressable>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 }}
        >
          {BARS.map((h, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: h,
                borderRadius: 2,
                backgroundColor: i < played ? pc.fill : colors.line,
              }}
            />
          ))}
        </View>
        <Text
          variant="caption"
          tone="text2"
          style={{ fontVariant: ['tabular-nums'] }}
          testID={testID && `${testID}-time`}
        >
          {playback.playing || playback.positionMs > 0
            ? formatVoiceTime(playback.positionMs)
            : time}
        </Text>
      </View>
      {playback.error ? (
        <Text
          variant="caption"
          style={{ color: colors.blushText }}
          testID={testID && `${testID}-error`}
        >
          {playback.error}
        </Text>
      ) : null}
    </View>
  );
}
