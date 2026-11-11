import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { PremiumWord } from '@/features/voice/components/VoiceAnswerCard';
import { useTranslation } from '@/i18n';
import { AnswerCard, Button, Icon, Text, useTheme } from '@/ui';

/**
 * MOB-71 (D55): History is Premium beyond yesterday. These pieces show a locked day: the lock and
 * the word "Premium" (D41: never colour alone), and the one way out, the paywall `from=history`
 * (16 headed "Unlock all your history with Premium"). Only a tap opens it (BIZ-16).
 */

/** Opens 16 for History. */
export function useOpenHistoryPaywall(): () => void {
  const router = useRouter();
  return () => router.push('/paywall?from=history');
}

/** Lock icon + "Premium", for a locked History row (inside the row's button, whose label says it). */
export function PremiumLockTag({ testID }: { testID?: string }) {
  const { colors, space } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Icon name="lock" size={14} color={colors.text3} />
      <PremiumWord />
    </View>
  );
}

/** One person's answer on a locked day: never fetched, so only the name, the lock and "Premium". */
export function LockedAnswerCard({
  name,
  avatarName,
  isMe,
  testID,
}: {
  name: string;
  avatarName?: string;
  isMe: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <AnswerCard
      testID={testID}
      name={name}
      {...(avatarName ? { avatarName } : {})}
      isMe={isMe}
      locked
      lockedText={t('history.locked.answer')}
      lockedLabel={
        isMe ? t('history.locked.answerA11yMine') : t('history.locked.answerA11y', { name })
      }
      lockedTag={<PremiumWord />}
    />
  );
}

/** "Today and yesterday are free…" and the button to 16 (`from=history`). */
export function HistoryUnlock({ body, testID }: { body: string; testID: string }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const open = useOpenHistoryPaywall();
  return (
    <View style={{ gap: space.md }} testID={testID}>
      <Text tone="text2" testID={`${testID}-body`}>
        {body}
      </Text>
      <Button
        testID={`${testID}-cta`}
        variant="premium"
        label={t('history.locked.cta')}
        onPress={open}
      />
    </View>
  );
}
