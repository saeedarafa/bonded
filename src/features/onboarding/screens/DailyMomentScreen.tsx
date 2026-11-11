import { useState } from 'react';
import { View } from 'react-native';

import { RITUAL_TIMES, ritualTime, type RitualTimeId } from '@/features/push/ritual';
import { acceptSoftAskSignedOut, declineSoftAsk } from '@/features/push/softAsk';
import { useTranslation } from '@/i18n';
import { Button, Icon, Mascot, OptionRow, Text, useTheme } from '@/ui';

import { TimeTile } from '../components';
import { OnboardingFrame } from '../OnboardingFrame';
import { usePendingSetup } from '../pendingSetup';
import { useOnboarding } from '../store';
import { TimePickerSheet } from '../TimePickerSheet';
import { useStepNav } from '../useStepNav';

const DEFAULT: RitualTimeId = 'evening';

type Choice = { kind: 'preset'; id: RitualTimeId } | { kind: 'other'; time: string };

function initialChoice(saved: string | null): Choice {
  if (!saved) return { kind: 'preset', id: DEFAULT };
  const preset = RITUAL_TIMES.find((r) => r.time === saved);
  return preset ? { kind: 'preset', id: preset.id } : { kind: 'other', time: saved };
}

/**
 * N Your daily moment + reminders (D50, D23). 08:00 / 12:30 / 21:00 tiles (21:00 picked, the
 * server default) or "Pick another time". The time stays on the phone (`usePendingSetup`) and is
 * written as `notification_prefs.ritual_time` after sign-in, whichever button is pressed.
 * "Turn on reminders" shows the OS prompt now (the token is registered after sign-in); "Not now"
 * is fine and is remembered, so 09 doesn't ask again after sign-in. Both go on to L.
 */
export function DailyMomentScreen() {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const nav = useStepNav('/plan/moment');
  const partner = useOnboarding((s) => s.partnerName).trim() || t('onboarding.partnerFallback');
  const [choice, setChoice] = useState<Choice>(() =>
    initialChoice(usePendingSetup.getState().ritualTime),
  );
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState(false);
  const time = choice.kind === 'preset' ? ritualTime(choice.id) : choice.time;

  const accept = async () => {
    if (asking) return;
    setAsking(true);
    const permission = await acceptSoftAskSignedOut();
    usePendingSetup.getState().setRitual(time, permission === 'granted' ? 'on' : 'off');
    setAsking(false);
    nav.next();
  };

  const decline = () => {
    declineSoftAsk();
    usePendingSetup.getState().setRitual(time, 'off');
    nav.next();
  };

  return (
    <OnboardingFrame
      screenId="N"
      footer={
        <>
          <Button
            testID="N-accept"
            icon="bell"
            label={t('onboarding.moment.accept')}
            loading={asking}
            onPress={() => void accept()}
          />
          <Button
            testID="N-decline"
            variant="ghost"
            label={t('onboarding.moment.decline')}
            onPress={decline}
          />
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: space.md }}>
        <View>
          <Mascot
            mood="celebrating"
            size={110}
            accessibilityLabel={t('onboarding.moment.mascot')}
          />
          <View
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={{
              position: 'absolute',
              right: -8,
              top: 6,
              width: 44,
              height: 44,
              borderRadius: radius.pill,
              backgroundColor: colors.youTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="bell" size={22} color={colors.youText} />
          </View>
        </View>
        <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('onboarding.moment.title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('onboarding.moment.body', { partner })}
        </Text>
      </View>
      <View style={{ gap: space.md }}>
        <Text variant="label">{t('onboarding.moment.question')}</Text>
        <View
          testID="N-times"
          accessibilityRole="radiogroup"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}
        >
          {RITUAL_TIMES.map((r) => {
            const label = t(`onboarding.moment.times.${r.id}`);
            return (
              <TimeTile
                key={r.id}
                testID={`N-time-${r.id}`}
                time={r.time}
                label={label}
                accessibilityLabel={t('onboarding.moment.tileA11y', { time: r.time, label })}
                selected={choice.kind === 'preset' && choice.id === r.id}
                onPress={() => setChoice({ kind: 'preset', id: r.id })}
              />
            );
          })}
        </View>
        {choice.kind === 'other' ? (
          <OptionRow
            testID="N-time-other"
            label={t('onboarding.moment.otherLabel')}
            trailing={choice.time}
            selected
            onPress={() => setPicking(true)}
          />
        ) : null}
        <Button
          testID="N-other"
          variant="link"
          label={t('onboarding.moment.other')}
          onPress={() => setPicking(true)}
        />
      </View>
      {picking ? (
        <TimePickerSheet
          visible
          initial={time}
          onDismiss={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false);
            const preset = RITUAL_TIMES.find((r) => r.time === picked);
            setChoice(preset ? { kind: 'preset', id: preset.id } : { kind: 'other', time: picked });
          }}
        />
      ) : null}
    </OnboardingFrame>
  );
}
