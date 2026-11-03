import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { BadgeUnlockedSheet } from '@/features/badges/components/BadgeUnlockedSheet';
import { useBadgeCelebration, useEarnedStreakSteps } from '@/features/badges/hooks';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { NUDGE_AVAILABLE } from '@/features/daily/api';
import {
  hasTodayActions,
  TodayActions,
  TodayBody,
  type TodayBodyProps,
} from '@/features/daily/components/TodayBody';
import {
  useNextQuestionCountdown,
  useNudge,
  useStreak,
  useTodayQuestion,
} from '@/features/daily/hooks';
import { dayNumber, todayState, togetherSince } from '@/features/daily/today';
import { JoinRequestCards } from '@/features/pairing/components/JoinRequestCards';
import { SoloInviteCard } from '@/features/pairing/components/SoloInviteCard';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useThreadUnread } from '@/features/thread/hooks';
import { useTranslation } from '@/i18n';
import { useDrafts } from '@/lib/drafts';
import { useCoupleRealtime } from '@/lib/useCoupleRealtime';
import {
  AvatarPair,
  Banner,
  Button,
  Chip,
  Mascot,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  useTheme,
  useToast,
} from '@/ui';

function clockTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** Today tab (MOB-10): 18 your turn, 23 waiting on partner, 24 bonded today, 28 napping. */
export default function TodayScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { userId } = useSession();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  const hasCouple = !!couple.data;
  const question = useTodayQuestion({ enabled: hasCouple });
  const streak = useStreak({ enabled: hasCouple });
  useCoupleRealtime(couple.data?.id);
  const secondsLeft = useNextQuestionCountdown(couple.data?.timezone);

  const me = profiles.me?.display_name?.trim() || t('today.you');
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const nudge = useNudge(partner);
  // The thread opens once both answered (RLS); only then is there anything unread.
  const bothIn =
    !!question.data &&
    question.data.answerCount >= 2 &&
    question.data.answers.some((a) => a.userId === userId);
  const unread = useThreadUnread(bothIn ? question.data?.id : undefined, userId);
  const revealedIds = useDrafts((s) => s.revealed);
  const earnedSteps = useEarnedStreakSteps({ enabled: hasCouple });
  const { celebration, markSeen } = useBadgeCelebration({ enabled: hasCouple });
  const [unlocked, setUnlocked] = useState<number | null>(null);

  // A streak badge awarded since this device last looked (MOB-17): 25 for 7/30/100 days, else the
  // 52b sheet. Only while Today is on screen; marked seen as it opens, so it never replays.
  useFocusEffect(
    useCallback(() => {
      if (!celebration || unlocked !== null) return;
      markSeen(celebration.awardIds);
      if (celebration.kind === 'milestone') router.push(`/milestone/${celebration.days}`);
      else setUnlocked(celebration.days);
    }, [celebration, unlocked, markSeen, router]),
  );

  if (couple.data === null) return <Redirect href="/" />;

  const error = couple.error ?? question.error ?? streak.error;
  const ready = couple.data && question.data && streak.data;
  const partnerJoined = isCoupleComplete(couple.data);

  let body;
  let actions = null;
  if (ready) {
    const mine = question.data.answers.find((a) => a.userId === userId) ?? null;
    const partnerAnswered = question.data.answerCount - (mine ? 1 : 0) >= 1;
    const state = todayState({
      answeredByMe: mine !== null,
      answerCount: question.data.answerCount,
      partnerJoined,
      streak: streak.data,
    });
    const day = dayNumber(togetherSince(couple.data), new Date(), couple.data.timezone);
    const revealed = revealedIds.includes(question.data.id);
    const props: TodayBodyProps = {
      state,
      me,
      partner,
      partnerJoined,
      partnerAnswered,
      question: question.data.question,
      day,
      myAnsweredAt: mine ? clockTime(mine.createdAt) : null,
      streak: streak.data,
      secondsLeft,
      onNudge: NUDGE_AVAILABLE
        ? () =>
            nudge.mutate(undefined, {
              onSuccess: () => useToast.getState().show(t('today.waiting.nudged', { partner })),
              onError: (e) => useToast.getState().show(e.message, 'error'),
            })
        : null,
      nudging: nudge.isPending,
      // J7: the joiner's first question, the partner already answered: lock in = instant reveal.
      onAnswer: () =>
        router.push(day === 1 && partnerAnswered ? '/today/answer?first=1' : '/today/answer'),
      onThread: () => router.push(revealed ? '/today/thread' : '/today/reveal'),
      unread: unread.data ?? 0,
      onReveal: state === 'bonded' && !revealed ? () => router.push('/today/reveal') : null,
      onSaver: () => router.push('/paywall'),
      earnedSteps,
      onBadges: () => router.push('/us/badges'),
      pinnedActions: true,
    };
    body = <TodayBody {...props} />;
    actions = hasTodayActions(props) ? <TodayActions {...props} /> : null;
  } else if (error) {
    body = (
      <View style={{ gap: space.lg }} testID="today-error">
        <Banner tone="error" message={error.message || t('today.loadError')} />
        <Button
          label={t('ui.retry')}
          onPress={() => {
            void couple.refetch();
            void question.refetch();
            void streak.refetch();
          }}
        />
      </View>
    );
  } else {
    body = (
      <SkeletonGroup testID="today-loading">
        <Skeleton height={120} width="40%" />
        <Skeleton height={220} />
        <Skeleton height={56} />
      </SkeletonGroup>
    );
  }

  const current = streak.data?.current ?? 0;
  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="today-screen"
    >
      <OfflineBanner />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
          paddingHorizontal: space.gutter,
          paddingVertical: space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 }}>
          <AvatarPair meName={me} partnerName={partner} />
          <View style={{ flex: 1 }}>
            <Text variant="label">{t('today.couple', { me, partner })}</Text>
            {couple.data ? (
              <Text variant="caption" tone="text3" style={{ fontVariant: ['tabular-nums'] }}>
                {t('today.dayTogether', {
                  n: dayNumber(togetherSince(couple.data), new Date(), couple.data.timezone),
                })}
              </Text>
            ) : null}
          </View>
        </View>
        {streak.data ? (
          <Chip
            testID="today-streak"
            tone="streak"
            label={String(current)}
            accessibilityLabel={t('today.streakA11y', { n: current })}
            leading={
              <Mascot mood={streak.data.completedToday ? 'together' : 'waiting'} size={24} />
            }
          />
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: space.gutter, paddingTop: space.sm }}>
        {/* D36: while solo the code stays in sight (design addition, PO review). */}
        {couple.data && !partnerJoined ? (
          <>
            {/* BE-26: someone typed my code and waits for my yes (also shown on 10 and 11). */}
            <JoinRequestCards screenId="today" enabled style={{ marginBottom: space.lg }} />
            <SoloInviteCard partner={partner} />
          </>
        ) : null}
        {body}
      </ScrollView>
      {/* #33: pinned above the tab bar, never behind it (small phones, 200% text). */}
      {actions ? (
        <View style={{ paddingHorizontal: space.gutter, paddingVertical: space.md }}>
          {actions}
        </View>
      ) : null}
      <BadgeUnlockedSheet
        days={unlocked}
        current={current}
        earned={earnedSteps ?? []}
        onDismiss={() => setUnlocked(null)}
      />
    </SafeAreaView>
  );
}
