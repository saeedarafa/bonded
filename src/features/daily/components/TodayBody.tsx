import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import {
  Avatar,
  BADGE_STEPS,
  BadgeLadder,
  Button,
  Chip,
  Icon,
  Mascot,
  QuestionCard,
  Text,
  personColors,
  useTheme,
  type IconName,
} from '@/ui';

import { formatCountdown, type Streak, type TodayState } from '../today';

export type TodayBodyProps = {
  state: TodayState;
  me: string;
  partner: string;
  partnerJoined: boolean;
  partnerAnswered: boolean;
  question: string;
  day: number;
  /** "08:12", when I answered (my own answer row). */
  myAnsweredAt: string | null;
  streak: Streak;
  secondsLeft: number;
  /** Null hides the nudge button (BE-10 not live yet). */
  onNudge: (() => void) | null;
  nudging: boolean;
  onAnswer: () => void;
  onThread: () => void;
  onSaver: () => void;
};

function PersonRow(props: {
  name: string;
  isMe: boolean;
  status: string;
  icon?: IconName;
  testID: string;
}) {
  const { colors, space } = useTheme();
  const pc = personColors(colors, props.isMe);
  return (
    <View
      testID={props.testID}
      accessible
      accessibilityLabel={`${props.name}, ${props.status}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
    >
      <Avatar name={props.name} isMe={props.isMe} size="sm" />
      <View style={{ flex: 1 }}>
        <Text variant="label">{props.name}</Text>
        <Text variant="caption" tone="text3" style={{ fontVariant: ['tabular-nums'] }}>
          {props.status}
        </Text>
      </View>
      {props.icon ? <Icon name={props.icon} size={20} color={pc.text} /> : null}
    </View>
  );
}

/** Screens 18, 23, 24 and 28: the body of Today under the header, one per state. */
export function TodayBody(p: TodayBodyProps) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const countdown = formatCountdown(p.secondsLeft);
  const card = {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  } as const;

  if (p.state === 'bonded') {
    const next = BADGE_STEPS.find((s) => s > p.streak.current);
    return (
      <View style={{ gap: space.xl }} testID="24-screen">
        <View style={{ alignItems: 'center', gap: space.md }}>
          <Mascot mood="together" size={170} partnerName={p.partner} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {p.streak.current > 1
              ? t('today.bonded.title', { n: p.streak.current })
              : t('today.bonded.titleFirst')}
          </Text>
        </View>
        <View style={card}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Text variant="label">{t('today.bonded.badges')}</Text>
            <Text variant="caption" tone="text3" style={{ fontVariant: ['tabular-nums'] }}>
              {next
                ? t('today.bonded.nextBadge', { days: next, left: next - p.streak.current })
                : t('today.bonded.allBadges')}
            </Text>
          </View>
          <BadgeLadder current={p.streak.current} testID="24-badges" />
        </View>
        <View
          style={[card, { alignItems: 'center', gap: space.xs }]}
          accessible
          accessibilityLabel={`${t('today.bonded.nextIn')} ${countdown}`}
        >
          <Text variant="caption" tone="text3">
            {t('today.bonded.nextIn')}
          </Text>
          <Text variant="display" style={{ fontVariant: ['tabular-nums'] }} testID="24-countdown">
            {countdown}
          </Text>
        </View>
        <Button variant="ghost" label={t('today.bonded.revisit')} onPress={p.onThread} />
      </View>
    );
  }

  if (p.state === 'napping') {
    const longest =
      p.streak.longest === 1
        ? t('today.napping.oneDay')
        : t('today.napping.days', { n: p.streak.longest });
    return (
      <View style={{ gap: space.xl }} testID="28-screen">
        <View style={{ alignItems: 'center', gap: space.md }}>
          <Mascot mood="napping" size={170} partnerName={p.partner} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('today.napping.title')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('today.napping.body')}
          </Text>
        </View>
        <View
          style={[
            card,
            { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
          ]}
        >
          <Text>{t('today.napping.longest')}</Text>
          <Text variant="number" style={{ fontVariant: ['tabular-nums'] }}>
            {longest}
          </Text>
        </View>
        <View style={[card, { borderColor: colors.premium, backgroundColor: colors.premiumTint }]}>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: space.sm,
            }}
          >
            <Text variant="h2">{t('today.napping.saverTitle')}</Text>
            <Chip tone="premium" label={t('today.napping.premium')} />
          </View>
          <Text tone="text2">{t('today.napping.saverBody')}</Text>
          <Button
            variant="premium"
            label={t('today.napping.saverCta')}
            onPress={p.onSaver}
            testID="28-saver"
          />
        </View>
        <Button label={t('today.napping.wake')} onPress={p.onAnswer} testID="28-answer" />
      </View>
    );
  }

  const waiting = p.state === 'waiting';
  const partnerStatus = !p.partnerJoined
    ? t('today.partnerNotJoined')
    : p.partnerAnswered
      ? t('today.partnerLocked')
      : t('today.partnerNotYet');
  const lead = waiting
    ? t('today.waiting.title', { partner: p.partner })
    : !p.partnerJoined
      ? t('today.yourTurn.solo', { partner: p.partner })
      : p.partnerAnswered
        ? t('today.yourTurn.partnerAnswered', { partner: p.partner })
        : t('today.yourTurn.fresh', { partner: p.partner });
  const streakHint =
    p.streak.current > 0
      ? t('today.waiting.keepStreak', { n: p.streak.current })
      : t('today.waiting.startStreak');

  return (
    <View style={{ gap: space.xl }} testID={waiting ? '23-screen' : '18-screen'}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        {!p.partnerJoined ? (
          <Mascot mood="saving-a-seat" size={120} partnerName={p.partner} />
        ) : waiting || p.partnerAnswered ? (
          <Mascot
            mood="waiting"
            awake={waiting ? 'you' : 'partner'}
            size={120}
            partnerName={p.partner}
          />
        ) : (
          <Mascot mood="waiting" size={120} accessibilityLabel={t('today.mascotFresh')} />
        )}
        <Text
          variant={waiting ? 'h2' : 'body'}
          accessibilityRole={waiting ? 'header' : undefined}
          style={{ textAlign: 'center' }}
        >
          {lead}
        </Text>
      </View>
      <QuestionCard
        dayLabel={t('today.dayLabel', { n: p.day })}
        question={p.question}
        meta={waiting ? undefined : t('today.newIn', { time: countdown })}
      >
        <View
          style={{
            gap: space.md,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingTop: space.md,
          }}
        >
          {waiting ? (
            <>
              <PersonRow
                testID="today-me"
                name={t('today.you')}
                isMe
                status={p.myAnsweredAt ? t('today.answeredAt', { time: p.myAnsweredAt }) : ''}
                icon="check"
              />
              <PersonRow
                testID="today-partner"
                name={p.partner}
                isMe={false}
                status={partnerStatus}
              />
            </>
          ) : (
            <>
              <PersonRow
                testID="today-partner"
                name={p.partner}
                isMe={false}
                status={partnerStatus}
                {...(p.partnerAnswered ? { icon: 'lock' as const } : {})}
              />
              <PersonRow
                testID="today-me"
                name={t('today.you')}
                isMe
                status={t('today.notAnswered')}
              />
            </>
          )}
        </View>
      </QuestionCard>
      {waiting ? (
        <View style={{ gap: space.sm }}>
          {p.onNudge ? (
            <Button
              variant="ghost"
              icon="bell"
              label={t('today.waiting.nudge', { partner: p.partner })}
              loading={p.nudging}
              onPress={p.onNudge}
              testID="23-nudge"
            />
          ) : null}
          <Text variant="caption" tone="text3" style={{ textAlign: 'center' }}>
            {p.onNudge ? `${t('today.waiting.nudgeHint')} ${streakHint}` : streakHint}
          </Text>
        </View>
      ) : (
        <Button label={t('today.answer')} onPress={p.onAnswer} testID="18-answer" />
      )}
    </View>
  );
}
