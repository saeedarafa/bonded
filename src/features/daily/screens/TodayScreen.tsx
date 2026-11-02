import { Redirect, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { NUDGE_AVAILABLE } from '@/features/daily/api';
import { TodayBody } from '@/features/daily/components/TodayBody';
import {
  useNextQuestionCountdown,
  useNudge,
  useStreak,
  useTodayQuestion,
} from '@/features/daily/hooks';
import { dayNumber, todayState } from '@/features/daily/today';
import { useCoupleProfiles } from '@/features/profile/hooks';
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
  const revealedIds = useDrafts((s) => s.revealed);

  if (couple.data === null) return <Redirect href="/" />;

  const error = couple.error ?? question.error ?? streak.error;
  const ready = couple.data && question.data && streak.data;
  const partnerJoined = isCoupleComplete(couple.data);

  let body;
  if (ready) {
    const mine = question.data.answers.find((a) => a.userId === userId) ?? null;
    const partnerAnswered = question.data.answerCount - (mine ? 1 : 0) >= 1;
    const state = todayState({
      answeredByMe: mine !== null,
      answerCount: question.data.answerCount,
      partnerJoined,
      streak: streak.data,
    });
    const day = dayNumber(couple.data.created_at, new Date(), couple.data.timezone);
    const revealed = revealedIds.includes(question.data.id);
    body = (
      <TodayBody
        state={state}
        me={me}
        partner={partner}
        partnerJoined={partnerJoined}
        partnerAnswered={partnerAnswered}
        question={question.data.question}
        day={day}
        myAnsweredAt={mine ? clockTime(mine.createdAt) : null}
        streak={streak.data}
        secondsLeft={secondsLeft}
        onNudge={
          NUDGE_AVAILABLE
            ? () =>
                nudge.mutate(undefined, {
                  onSuccess: () => useToast.getState().show(t('today.waiting.nudged', { partner })),
                  onError: (e) => useToast.getState().show(e.message, 'error'),
                })
            : null
        }
        nudging={nudge.isPending}
        // J7: the joiner's first question, the partner already answered: lock in = instant reveal.
        onAnswer={() =>
          router.push(day === 1 && partnerAnswered ? '/today/answer?first=1' : '/today/answer')
        }
        onThread={() => router.push(revealed ? '/today/thread' : '/today/reveal')}
        onReveal={state === 'bonded' && !revealed ? () => router.push('/today/reveal') : null}
        onSaver={() => router.push('/paywall')}
      />
    );
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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
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
                  n: dayNumber(couple.data.created_at, new Date(), couple.data.timezone),
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
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
