import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { BadgeLadder, Button, Confetti, haptics, nextBadgeStep, Sheet, Text, useTheme } from '@/ui';

import { BadgePop } from './BadgePop';

type Props = {
  /** The streak step just unlocked; null hides the sheet. */
  days: number | null;
  /** Current streak (ring progress of the next step). */
  current: number;
  /** Streak steps awarded so far (the ladder). */
  earned: readonly number[];
  onDismiss: () => void;
};

/**
 * 52b Badge unlocked: a sheet over Today for the steps without a full milestone (1, 3, 14, 21,
 * 50, 365). Heavy haptic, one burst of confetti; reduced motion: no confetti, the badge fades in.
 */
export function BadgeUnlockedSheet({ days, current, earned, onDismiss }: Props) {
  const visible = days !== null;
  return (
    <Sheet visible={visible} onDismiss={onDismiss} testID="52b-sheet">
      {days !== null ? (
        <UnlockedBody days={days} current={current} earned={earned} onDismiss={onDismiss} />
      ) : null}
    </Sheet>
  );
}

function UnlockedBody({
  days,
  current,
  earned,
  onDismiss,
}: { days: number } & Omit<Props, 'days'>) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const [confetti, setConfetti] = useState(true);
  const steps = earned.includes(days) ? earned : [...earned, days];
  const next = nextBadgeStep(Math.max(current, days), undefined, steps);

  useEffect(() => {
    haptics.heavy();
    AccessibilityInfo.announceForAccessibility(t('badges.unlocked.announce', { n: days }));
  }, [days, t]);

  const body =
    next === undefined
      ? t('badges.unlocked.bodyLast', { n: days })
      : days === 1
        ? t('badges.unlocked.bodyFirst', { next })
        : t('badges.unlocked.body', { n: days, next });

  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <BadgePop>
        <View
          testID="52b-badge"
          accessible
          accessibilityLabel={t('badges.unlocked.badgeA11y', { n: days })}
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            borderWidth: 8,
            borderColor: colors.youTint,
            backgroundColor: colors.you,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Fixed circle: the label carries the meaning at large text sizes. */}
          <Text
            variant="display"
            allowFontScaling={false}
            style={{ color: colors.onYou, fontVariant: ['tabular-nums'] }}
          >
            {days}
          </Text>
          <Text variant="caption" allowFontScaling={false} style={{ color: colors.onYou }}>
            {days === 1 ? t('badges.unlocked.daysOne') : t('badges.unlocked.days')}
          </Text>
        </View>
      </BadgePop>
      <Text
        variant="h2"
        accessibilityRole="header"
        style={{ textAlign: 'center' }}
        testID="52b-title"
      >
        {t('badges.unlocked.title', { n: days })}
      </Text>
      <Text tone="text2" style={{ textAlign: 'center' }}>
        {body}
      </Text>
      <View style={{ alignSelf: 'stretch' }}>
        <BadgeLadder
          current={Math.max(current, days)}
          earned={steps}
          highlight={days}
          testID="52b-ladder"
        />
      </View>
      <View style={{ alignSelf: 'stretch' }}>
        <Button testID="52b-keep-going" label={t('badges.unlocked.cta')} onPress={onDismiss} />
      </View>
      <Confetti active={confetti} onDone={() => setConfetti(false)} testID="52b-confetti" />
    </View>
  );
}
