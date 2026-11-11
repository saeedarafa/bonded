import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Linking,
  Pressable,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { SHIPPED } from '@/features/premium/features';
import { usePremium } from '@/features/premium/hooks';
import type { VoiceMessageTake } from '@/features/thread/hooks';
import { formatVoiceTime, VOICE_MESSAGE_MAX_MS } from '@/features/voice/encoding';
import { useVoiceRecorder } from '@/features/voice/useVoiceRecorder';
import { useTranslation } from '@/i18n';
import {
  Button,
  Composer,
  haptics,
  Icon,
  Text,
  useReducedMotion,
  useScreenReader,
  useTheme,
} from '@/ui';

/** A finger this far left of where the hold started cancels the recording (22b). */
export const SLIDE_TO_CANCEL_PX = 80;

/** The finger can wander anywhere while holding: only lifting it ends the hold. */
const HOLD_RETENTION = { top: 1000, bottom: 1000, left: 1000, right: 1000 };

type Props = {
  coupleId: string | undefined;
  userId: string | null;
  partner: string;
  onSend: (text: string) => void;
  onTyping: () => void;
  onSendVoice: (take: VoiceMessageTake) => void;
};

/**
 * The thread's composer (22). With voice in the build (D27 `SHIPPED.voice`, D46) a mic button sits
 * next to it: Premium couples hold it to record a voice message (22b), free couples are told that
 * voice is Premium and the mic opens the paywall. Everyone can play voice messages.
 */
export function ThreadComposer(props: Props) {
  if (!SHIPPED.voice) return <TextComposer {...props} />;
  return <VoiceAwareComposer {...props} />;
}

function TextComposer({ partner, onSend, onTyping }: Props) {
  const { t } = useTranslation();
  return (
    <Composer
      testID="22-composer"
      placeholder={t('thread.reply', { partner })}
      onSend={onSend}
      onTyping={onTyping}
    />
  );
}

function VoiceAwareComposer(props: Props) {
  const premium = usePremium();
  // Until Premium is known (or if it can't be read) the thread stays text-only: no mic, no note.
  if (premium.status !== 'ready') return <TextComposer {...props} />;
  return premium.isPremium ? <RecordingComposer {...props} /> : <FreeComposer {...props} />;
}

/** The round 44 pt+ button right of the composer (mic, or send while recording). */
function RoundButton({
  testID,
  label,
  hint,
  icon,
  filled,
  ...handlers
}: {
  testID: string;
  label: string;
  hint?: string;
  icon: 'mic' | 'send';
  filled: boolean;
  onPress?: () => void;
  onPressIn?: (e: GestureResponderEvent) => void;
  onPressOut?: () => void;
  onTouchMove?: (e: GestureResponderEvent) => void;
  pressRetentionOffset?: typeof HOLD_RETENTION;
}) {
  const { colors, size } = useTheme();
  const box = size.tapTarget + 8;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint ? { accessibilityHint: hint } : {})}
      {...handlers}
      style={{
        width: box,
        height: box,
        borderRadius: box / 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: filled ? 0 : 1,
        borderColor: colors.line,
        backgroundColor: filled ? colors.you : colors.surface,
      }}
    >
      <Icon name={icon} color={filled ? colors.onYou : colors.text2} />
    </Pressable>
  );
}

/** D46: free couples can listen to voice messages but not record; the mic opens the paywall. */
function FreeComposer(props: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="caption" tone="text2" style={{ textAlign: 'center' }} testID="22b-free-note">
        {t('thread.voice.freeNote')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextComposer {...props} />
        </View>
        <RoundButton
          testID="22b-mic-premium"
          label={t('thread.voice.recordPremiumA11y')}
          icon="mic"
          filled={false}
          onPress={() => router.push({ pathname: '/paywall', params: { from: 'voice' } })}
        />
      </View>
    </View>
  );
}

/**
 * 22b hold-to-record (Premium). Hold the mic: it records (up to 60 s, then it stops by itself);
 * slide left to cancel; let go to send. With a screen reader or reduced motion the hold becomes a
 * tap: tap the mic to record, then "Send voice message" or "Cancel" (DESIGN.md: tap instead of
 * hold). The take is handed to the thread's optimistic send, which keeps it until it is on the
 * server. Nothing about the recording is logged.
 */
function RecordingComposer(props: Props) {
  const { coupleId, userId, onSendVoice } = props;
  const { t } = useTranslation();
  const { colors, space, radius, size } = useTheme();
  const reduced = useReducedMotion();
  const screenReader = useScreenReader();
  const tapMode = reduced || screenReader;
  const recorder = useVoiceRecorder({
    coupleId,
    userId,
    maxMs: VOICE_MESSAGE_MAX_MS,
    context: 'message',
  });
  const holding = useRef(false);
  const cancelled = useRef(false);
  const startX = useRef(0);
  const [holdHint, setHoldHint] = useState(false);

  const recording = recorder.phase === 'recording' || recorder.phase === 'starting';
  const active = recording || (recorder.phase === 'recorded' && !!recorder.take);

  const finish = async () => {
    const take = await recorder.stop();
    if (!take) {
      // A tap, not a hold (shorter than half a second): say how it works.
      if (!tapMode && !recorder.denied) setHoldHint(true);
      return;
    }
    haptics.light();
    onSendVoice(take);
    // The outbox holds the take now, so this only resets the recorder (the file stays).
    recorder.discard();
  };

  const cancel = () => {
    void recorder.cancel();
    haptics.light();
    AccessibilityInfo.announceForAccessibility(t('thread.voice.cancelled'));
  };

  const begin = async () => {
    setHoldHint(false);
    const ok = await recorder.start();
    // Let go while the microphone was still starting (e.g. the permission prompt): no take.
    if (ok && !tapMode && !holding.current) void recorder.cancel();
  };

  const holdHandlers = tapMode
    ? {
        onPress: () => {
          if (active) void finish();
          else void begin();
        },
      }
    : {
        pressRetentionOffset: HOLD_RETENTION,
        onPressIn: (e: GestureResponderEvent) => {
          holding.current = true;
          cancelled.current = false;
          startX.current = e.nativeEvent.pageX;
          haptics.light();
          void begin();
        },
        onTouchMove: (e: GestureResponderEvent) => {
          if (!holding.current || cancelled.current) return;
          if (e.nativeEvent.pageX - startX.current <= -SLIDE_TO_CANCEL_PX) {
            cancelled.current = true;
            cancel();
          }
        },
        onPressOut: () => {
          if (!holding.current) return;
          holding.current = false;
          if (!cancelled.current) void finish();
        },
      };

  const elapsed = formatVoiceTime(
    recorder.phase === 'recorded' && recorder.take ? recorder.take.durationMs : recorder.elapsedMs,
  );

  return (
    <View style={{ gap: space.sm }}>
      {recorder.denied ? (
        <View style={{ gap: space.xs }} testID="22b-mic-denied">
          <Text variant="caption" tone="text2">
            {t('voice.mic.denied')}
          </Text>
          <Button
            testID="22b-open-settings"
            variant="link"
            label={t('voice.mic.openSettings')}
            onPress={() => void Linking.openSettings()}
          />
        </View>
      ) : null}
      {recorder.failed ? (
        <Text variant="caption" style={{ color: colors.blushText }} testID="22b-failed">
          {t('voice.answer.failed')}
        </Text>
      ) : null}
      {holdHint ? (
        <Text variant="caption" tone="text2" style={{ textAlign: 'center' }} testID="22b-hold-hint">
          {t('thread.voice.holdHint')}
        </Text>
      ) : null}
      {recorder.autoStopped && recorder.phase === 'recorded' ? (
        <Text variant="caption" tone="text2" testID="22b-auto-stopped">
          {t('thread.voice.autoStopped')}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        {/* Kept mounted while recording, so typed text survives a voice message. */}
        <View style={{ flex: 1, ...(active ? { display: 'none' as const } : {}) }}>
          <TextComposer {...props} />
        </View>
        {active ? (
          <View
            testID="22b-recording"
            accessible={!tapMode}
            accessibilityLabel={t('thread.voice.recordingA11y', { time: elapsed })}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm + 2,
              minHeight: size.tapTarget + 8,
              paddingHorizontal: space.lg,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.blushText,
              backgroundColor: colors.surface,
            }}
          >
            <View
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blushText }}
            />
            <Text
              variant="label"
              style={{ fontVariant: ['tabular-nums'] }}
              testID="22b-timer"
              {...(tapMode
                ? { accessibilityLabel: t('thread.voice.recordingA11y', { time: elapsed }) }
                : {})}
            >
              {elapsed}
            </Text>
            {tapMode ? (
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Button
                  testID="22b-cancel"
                  variant="link"
                  label={t('thread.voice.cancel')}
                  accessibilityHint={t('thread.voice.cancelA11y')}
                  onPress={cancel}
                />
              </View>
            ) : (
              <Text
                variant="caption"
                tone="text2"
                style={{ flex: 1, textAlign: 'right' }}
                testID="22b-slide-to-cancel"
              >
                {t('thread.voice.slideToCancel')}
              </Text>
            )}
          </View>
        ) : null}
        {/* The same element before and during a hold: the finger stays on it. */}
        <RoundButton
          testID="22b-mic"
          label={active ? t('thread.voice.send') : t('thread.voice.record')}
          {...(tapMode
            ? active
              ? {}
              : { hint: t('thread.voice.recordTapA11y') }
            : { hint: t('thread.voice.recordHint') })}
          icon={active ? 'send' : 'mic'}
          filled={active}
          {...holdHandlers}
        />
      </View>
    </View>
  );
}
