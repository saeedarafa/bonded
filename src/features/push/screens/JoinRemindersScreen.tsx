import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useSession } from '@/features/auth/session';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { Button, OptionRow, Skeleton, SkeletonGroup, useTheme } from '@/ui';

import { SoftAskBody } from '../components/SoftAskBody';
import { useAcceptSoftAsk, usePartnerRitualTime } from '../hooks';
import { DEFAULT_RITUAL, ritualTime, shortTime, type RitualTimeId } from '../ritual';
import { declineSoftAsk, useShouldSoftAsk } from '../softAsk';

const NEXT = '/paired';
const STEP = 3;
const STEPS = 3;

/**
 * J6 Reminders matched (joiner, 3 of 3, after joining). "Same as Maya" is the default once the
 * partner's ritual time can be read; until then (Needs from backend) it is 09's time list.
 * Then the system prompt, once per device, like 09.
 */
export default function JoinRemindersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { space } = useTheme();
  const { status, userId } = useSession();
  const { partner: partnerProfile } = useCoupleProfiles();
  const ask = useShouldSoftAsk();
  const accept = useAcceptSoftAsk();
  const partnerTime = usePartnerRitualTime().data ?? null;
  const [mode, setMode] = useState<'same' | 'own'>('same');
  const [choice, setChoice] = useState<RitualTimeId>(DEFAULT_RITUAL);

  if (status === 'signedOut') return <Redirect href="/join/sign-in" />;
  if (ask === false) return <Redirect href={NEXT} />;

  const partner = partnerProfile?.display_name.trim() || t('pairing.partnerFallback');
  const matched = partnerTime ? shortTime(partnerTime) : null;
  const same = matched !== null && mode === 'same';
  const time = same ? matched : ritualTime(choice);

  return (
    <OnboardingFrame
      screenId="J6"
      step={{ n: STEP, total: STEPS }}
      footer={
        ask && userId ? (
          <>
            <Button
              testID="J6-accept"
              label={t('push.softAsk.accept')}
              loading={accept.isPending}
              onPress={() => {
                if (accept.isPending) return;
                accept.mutate(
                  { userId, ritualTime: time },
                  { onSettled: () => router.replace(NEXT) },
                );
              }}
            />
            <Button
              testID="J6-decline"
              variant="link"
              label={t('push.softAsk.decline')}
              onPress={() => {
                declineSoftAsk();
                router.replace(NEXT);
              }}
            />
          </>
        ) : null
      }
    >
      {ask && userId ? (
        matched ? (
          <SoftAskBody
            screenId="J6"
            partner={partner}
            previewTime={time}
            title={t('push.softAsk.matchedTitle', { partner })}
            body={t('push.softAsk.matchedBody')}
            {...(mode === 'own'
              ? { times: { selected: choice, onSelect: setChoice, heading: false } }
              : {})}
          >
            <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
              <OptionRow
                testID="J6-same"
                label={t('push.softAsk.same', { partner })}
                trailing={matched}
                selected={mode === 'same'}
                onPress={() => setMode('same')}
              />
              <OptionRow
                testID="J6-own"
                label={t('push.softAsk.own')}
                selected={mode === 'own'}
                onPress={() => setMode('own')}
              />
            </View>
          </SoftAskBody>
        ) : (
          <SoftAskBody
            screenId="J6"
            partner={partner}
            previewTime={time}
            title={t('push.softAsk.title')}
            body={t('push.softAsk.body', { partner })}
            times={{ selected: choice, onSelect: setChoice, heading: true }}
          />
        )
      ) : (
        <SkeletonGroup testID="J6-loading">
          <Skeleton height={88} />
          <Skeleton height={64} />
          <Skeleton height={168} />
        </SkeletonGroup>
      )}
    </OnboardingFrame>
  );
}
