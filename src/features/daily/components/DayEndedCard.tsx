import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { deleteLocalTake } from '@/features/voice/api';
import { useTranslation } from '@/i18n';
import { useOutbox, type QueuedAnswer } from '@/lib/outbox';
import { Button, Icon, Text, useTheme } from '@/ui';

/** Queued answers of mine that the server refused because their day had ended (D56). */
export function dayEndedAnswers(
  answers: Record<string, QueuedAnswer>,
  userId: string | null | undefined,
  todayId: string | null | undefined,
): QueuedAnswer[] {
  if (!userId) return [];
  return Object.values(answers)
    .filter(
      (a) =>
        a.userId === userId &&
        a.status === 'failed' &&
        a.errorKind === 'DAY_ENDED' &&
        a.coupleQuestionId !== todayId,
    )
    .sort((a, b) => b.clientWrittenAt.localeCompare(a.clientWrittenAt));
}

/**
 * MOB-73 (D56, BE-57): an answer locked in offline that reached the server after its day (plus the
 * 15-minute grace) was refused with `DAY_ENDED`. Today says so once, above today's question, which
 * is the offer: "This day has ended", the text is still on this phone (I can read it here, it is
 * mine), no paywall and no way to send it again. OK forgets the queued entry (and a voice take's file); a
 * text draft stays in the encrypted draft store. Not on a board: neutral card, GAPS row 2026-11-11.
 *
 * Shows the newest refused answer only (the outbox keeps at most five).
 */
export function DayEndedCard({
  userId,
  todayId,
}: {
  userId: string | null | undefined;
  todayId: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const answers = useOutbox((s) => s.answers);
  const removeAnswer = useOutbox((s) => s.removeAnswer);
  const ended = useMemo(
    () => dayEndedAnswers(answers, userId, todayId),
    [answers, userId, todayId],
  );
  const [open, setOpen] = useState(false);
  const latest = ended[0];
  if (!latest) return null;
  const isVoice = !!latest.voice;

  return (
    <View
      testID="today-day-ended"
      style={{
        gap: space.md,
        padding: space.lg,
        marginBottom: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}
      >
        <Icon name="lock" size={18} color={colors.text2} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="label" accessibilityRole="header">
            {t('today.dayEnded.title')}
          </Text>
          <Text variant="caption" tone="text2">
            {t('today.dayEnded.body')}
          </Text>
        </View>
      </View>
      {open ? (
        <Text testID="today-day-ended-text" tone="text2">
          {isVoice ? t('today.dayEnded.voice') : latest.body}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button
          testID="today-day-ended-show"
          variant="ghost"
          label={open ? t('today.dayEnded.hide') : t('today.dayEnded.show')}
          onPress={() => setOpen((v) => !v)}
        />
        <Button
          testID="today-day-ended-dismiss"
          variant="ghost"
          label={t('today.dayEnded.dismiss')}
          onPress={() => {
            for (const a of ended) {
              removeAnswer(a.coupleQuestionId);
              // A voice take can't be sent anymore: free the space on the phone.
              if (a.voice) deleteLocalTake(a.voice.fileUri);
            }
          }}
        />
      </View>
    </View>
  );
}
