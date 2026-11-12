import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';

import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { useTranslation } from '@/i18n';
import { Button, Skeleton, SkeletonGroup } from '@/ui';

import { SoftAskBody } from '../components/SoftAskBody';
import { useAcceptSoftAsk } from '../hooks';
import { DEFAULT_RITUAL, ritualTime, type RitualTimeId } from '../ritual';
import { declineSoftAsk, useShouldSoftAsk } from '../softAsk';

const NEXT = '/invite';

/**
 * 09 Reminder primer (inviter, after setting up the couple, before the invite). Our own ask first;
 * the system prompt only after "Turn on reminders" (MOB-15). Shown once per device: answered
 * before, or the OS already decided, and it steps aside to the invite.
 */
export default function RemindersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { userId } = useSession();
  const couple = useActiveCouple();
  const ask = useShouldSoftAsk();
  const accept = useAcceptSoftAsk();
  const [choice, setChoice] = useState<RitualTimeId>(DEFAULT_RITUAL);

  if (ask === false || !userId) return <Redirect href={NEXT} />;

  const partner = couple.data?.partner_name?.trim() || t('pairing.partnerFallback');
  const time = ritualTime(choice);

  return (
    <OnboardingFrame
      screenId="09"
      footer={
        ask ? (
          <>
            <Button
              testID="09-accept"
              label={t('push.softAsk.accept')}
              loading={accept.isPending}
              onPress={() => {
                if (accept.isPending) return;
                accept.mutate(
                  { userId, ritualTime: time, screen: '09' },
                  { onSettled: () => router.replace(NEXT) },
                );
              }}
            />
            <Button
              testID="09-decline"
              variant="link"
              label={t('push.softAsk.decline')}
              onPress={() => {
                declineSoftAsk('09');
                router.replace(NEXT);
              }}
            />
          </>
        ) : null
      }
    >
      {ask ? (
        <SoftAskBody
          screenId="09"
          partner={partner}
          previewTime={time}
          title={t('push.softAsk.title')}
          body={t('push.softAsk.body', { partner })}
          times={{ selected: choice, onSelect: setChoice, heading: true }}
        />
      ) : (
        <SkeletonGroup testID="09-loading">
          <Skeleton height={88} />
          <Skeleton height={64} />
          <Skeleton height={168} />
        </SkeletonGroup>
      )}
    </OnboardingFrame>
  );
}
