import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { BadgeUnlockedSheet } from '@/features/badges/components/BadgeUnlockedSheet';
import { useBadgeCelebration, useEarnedStreakSteps } from '@/features/badges/hooks';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { NUDGE_AVAILABLE } from '@/features/daily/api';
import { DayEndedCard } from '@/features/daily/components/DayEndedCard';
import {
  hasTodayActions,
  TodayActions,
  TodayBody,
  type TodayBodyProps,
} from '@/features/daily/components/TodayBody';
import {
  useNextQuestionCountdown,
  useNudge,
  useNudgedToday,
  useStreak,
  useStreakSaver,
  useTodayQuestion,
} from '@/features/daily/hooks';
import {
  hoursAfterRitual,
  trackOnce,
  useDailyViewEvents,
  useQuestionRef,
} from '@/features/daily/analytics';
import { dayNumber, todayState, togetherSince } from '@/features/daily/today';
import { useCheckIn } from '@/features/feedback/checkIn';
import { CheckInSheet } from '@/features/feedback/components/CheckInSheet';
import { shouldOfferCheckIn } from '@/features/feedback/model';
import {
  BUTTON_INSET,
  BUTTON_SIZE,
  LittleThings,
} from '@/features/littleThings/components/LittleThings';
import { useGestureStage } from '@/features/littleThings/hooks';
import { JoinRequestCards } from '@/features/pairing/components/JoinRequestCards';
import { SoloInviteCard } from '@/features/pairing/components/SoloInviteCard';
import { GiftChip } from '@/features/premium/components/GiftChip';
import { SHIPPED } from '@/features/premium/features';
import { useDay3Offer, useGiftGate, usePremium } from '@/features/premium/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { ReviewErrorDayMark } from '@/features/review/review';
import { DEFAULT_RITUAL, ritualTime } from '@/features/push/ritual';
import { useNotificationPrefs } from '@/features/settings/hooks';
import { useThreadUnread } from '@/features/thread/hooks';
import { useTranslation } from '@/i18n';
import { analyticsEnabled, track } from '@/lib/analytics';
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
  useCramped,
  useTheme,
  useToast,
} from '@/ui';

const partnerJoinedNow = (c: Parameters<typeof isCoupleComplete>[0] | undefined) =>
  !!c && isCoupleComplete(c);

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
  const [napping, setNapping] = useState(false);
  // While 28 shows, poll the streak so a saver used on the partner's phone shows here too (no
  // realtime event exists for it; focus and reconnect refetch as well).
  const streak = useStreak({ enabled: hasCouple, refetchInterval: napping ? 60_000 : false });
  const premium = usePremium();
  const saver = useStreakSaver();
  useCoupleRealtime(couple.data?.id);
  const secondsLeft = useNextQuestionCountdown(couple.data?.timezone);
  const cramped = useCramped();
  // D48 (MOB-66): the hero acts out a little thing while LittleThings stages one.
  const staged = useGestureStage((s) => s.current);

  const me = profiles.me?.display_name?.trim() || t('today.you');
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const nudge = useNudge(partner, couple.data?.timezone);
  const nudged = useNudgedToday(couple.data?.timezone);
  // The thread opens once both answered (RLS); only then is there anything unread.
  const bothIn =
    !!question.data &&
    question.data.answerCount >= 2 &&
    question.data.answers.some((a) => a.userId === userId);
  const unread = useThreadUnread(bothIn ? question.data?.id : undefined, userId);
  const revealedIds = useDrafts((s) => s.revealed);
  const earnedSteps = useEarnedStreakSteps({ enabled: hasCouple });
  const { celebration, markSeen } = useBadgeCelebration({
    enabled: hasCouple,
    streak: streak.data,
  });
  const [unlocked, setUnlocked] = useState<number | null>(null);
  // D52 day-3 gift: 14 replaces 52b for the couple's first 3-day badge while the server's gift
  // is live (and the store doesn't refuse it), once per phone, at most one full-screen offer a day.
  const gift = useDay3Offer({ enabled: hasCouple });
  const giftGate = useGiftGate();
  const [giftDeciding, setGiftDeciding] = useState(false);
  const giftAsked = useRef(false);
  // 26 monthly check-in (MOB-23): a calm moment only, after today's reveal, never over a badge,
  // milestone or offer; at most once every 30 days on this phone (opening counts as asked).
  const [checkInOpen, setCheckInOpen] = useState(false);
  // D48 little things (MOB-58): the fan sits over Today; the pinned actions push the button up.
  const [fanOpen, setFanOpen] = useState(false);
  const [actionsHeight, setActionsHeight] = useState(0);
  const markCheckInAsked = useCheckIn((s) => s.markAsked);

  // A streak badge earned in the last 48 h, not yet seen here (MOB-17, MOB-41): 25 for 7/30/100
  // days, else the 52b sheet. Older ones (a fresh sign-in on an existing streak) only show on 52. Only while Today is on screen; marked seen as it opens, so it never replays.
  useFocusEffect(
    useCallback(() => {
      if (unlocked !== null || giftDeciding || giftGate.deciding) return;
      const ask = (unopenedOnly: boolean, onNo: () => void) => {
        setGiftDeciding(true);
        void giftGate.decide({ unopenedOnly }).then((show) => {
          setGiftDeciding(false);
          if (show) router.push('/gift');
          else onNo();
        });
      };
      if (!celebration) {
        // A live gift never opened and never shown on this phone (the badge was celebrated
        // elsewhere, or over 48 h ago): 14 once, if today's full-screen offer is still free.
        if (gift.offer && !gift.offer.opened && !giftAsked.current) {
          giftAsked.current = true;
          ask(true, () => {});
        }
        return;
      }
      markSeen(celebration.awardIds);
      if (celebration.kind === 'milestone') {
        router.push(`/milestone/${celebration.days}`);
        return;
      }
      const days = celebration.days;
      if (days === 3 && giftGate.ready) {
        giftAsked.current = true;
        ask(false, () => setUnlocked(days));
        return;
      }
      setUnlocked(days);
    }, [celebration, unlocked, markSeen, router, gift.offer, giftGate, giftDeciding]),
  );

  // Today is a good moment for 26 when both answered and I've seen the reveal.
  let checkInDay: number | null = null;
  if (couple.data && question.data && streak.data && userId) {
    const bonded =
      todayState({
        answeredByMe: question.data.answers.some((a) => a.userId === userId),
        answerCount: question.data.answerCount,
        partnerJoined: isCoupleComplete(couple.data),
        streak: streak.data,
      }) === 'bonded' && revealedIds.includes(question.data.id);
    if (bonded)
      checkInDay = dayNumber(togetherSince(couple.data), new Date(), couple.data.timezone);
  }
  const checkInBusy = !!celebration || giftDeciding || unlocked !== null || checkInOpen;
  useFocusEffect(
    useCallback(() => {
      if (checkInDay === null || !userId) return;
      const now = Date.now();
      const due = shouldOfferCheckIn({
        bondedToday: true,
        day: checkInDay,
        lastAskedAt: useCheckIn.getState().lastAskedAt(userId),
        now,
        busy: checkInBusy,
      });
      if (!due) return;
      markCheckInAsked(userId, now);
      setCheckInOpen(true);
    }, [checkInDay, checkInBusy, userId, markCheckInAsked]),
  );

  // Analytics (MOB-24c, §3.5): ids and flags only, never the question text.
  const prefs = useNotificationPrefs({ enabled: analyticsEnabled() });
  const questionRef = useQuestionRef(question.data);
  const answeredByMe = !!question.data?.answers.some((a) => a.userId === userId);
  useDailyViewEvents({
    coupleQuestionId: partnerJoinedNow(couple.data) ? question.data?.id : undefined,
    ref: questionRef,
    iAnswered: answeredByMe,
    partnerAnswered: !!question.data && question.data.answerCount - (answeredByMe ? 1 : 0) >= 1,
    waiting: answeredByMe && !!question.data && question.data.answerCount < 2,
    // No prefs row yet: the server default ritual time (D23).
    hoursAfterRitual:
      prefs.data === undefined
        ? null
        : hoursAfterRitual(
            new Date(),
            prefs.data?.ritual_time ?? ritualTime(DEFAULT_RITUAL),
            couple.data?.timezone,
          ),
  });

  // §3.6 (MOB-24d): 28's saver card, once per missed day on this phone. `streak` = the couple's
  // current streak, as everywhere else.
  const saverStreak = napping ? streak.data?.current : undefined;
  const saverDay = streak.data?.lastCompletedOn ?? 'none';
  useEffect(() => {
    if (saverStreak !== undefined) {
      trackOnce('streak_saver_viewed', saverDay, { streak: saverStreak });
    }
  }, [saverStreak, saverDay]);

  if (couple.data === null) return <Redirect href="/" />;

  // D48/D53: on every Today state once both partners are in (sending needs a pair); receiving
  // (24d) lives in the same overlay. D27: behind the ship flag until the PO turns it on.
  const littleThings = SHIPPED.littleThings && !!couple.data && isCoupleComplete(couple.data);
  const gesture = littleThings ? staged : null;
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
    if ((state === 'napping') !== napping) setNapping(state === 'napping');
    const day = dayNumber(togetherSince(couple.data), new Date(), couple.data.timezone);
    // 28 (D18): the server's `saver_available` already means "premium and yesterday can be saved".
    const saverState = streak.data.saverAvailable
      ? 'available'
      : premium.isPremium
        ? 'unavailable'
        : 'offer';
    const saverError = saver.error
      ? saver.error.kind === 'SAVER_UNAVAILABLE'
        ? t('today.napping.saverUsed')
        : saver.error.kind === 'PREMIUM_REQUIRED'
          ? t('today.napping.saverNeedsPremium')
          : saver.error.message
      : null;
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
              onError: (e) => {
                // Already nudged today: the "nudged" line replaces the button, no error.
                if (e.kind === 'NUDGE_LIMIT') return;
                // They just answered: Today refreshes into the next state; say why, gently.
                if (e.kind === 'PARTNER_ALREADY_ANSWERED')
                  useToast.getState().show(e.message, 'info');
                else useToast.getState().show(e.message, 'error');
              },
            })
        : null,
      nudging: nudge.isPending,
      nudged,
      // J7: the joiner's first question, the partner already answered: lock in = instant reveal.
      onAnswer: () =>
        router.push(day === 1 && partnerAnswered ? '/today/answer?first=1' : '/today/answer'),
      onThread: () => router.push(revealed ? '/today/thread' : '/today/reveal'),
      unread: unread.data ?? 0,
      onReveal: state === 'bonded' && !revealed ? () => router.push('/today/reveal') : null,
      saver: saverState,
      saving: saver.isPending,
      saverError,
      onSaver: () => {
        if (saverState !== 'available') {
          return router.push({ pathname: '/paywall', params: { from: 'streak_saver' } });
        }
        if (saver.isPending) return;
        saver.mutate(undefined, {
          onSuccess: (s) => {
            track('streak_saver_used', { streak: s.current });
            useToast.getState().show(t('today.napping.saved', { count: s.current }), 'success');
          },
        });
      },
      earnedSteps,
      onBadges: () => router.push('/us/badges'),
      pinnedActions: true,
      gesture,
    };
    body = <TodayBody {...props} />;
    actions = hasTodayActions(props) ? <TodayActions {...props} /> : null;
  } else if (error) {
    body = (
      <View style={{ gap: space.lg }} testID="today-error">
        <ReviewErrorDayMark />
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
  // #66: at a large text size on a short screen, avatars and names stack and wrap by word.
  const header = (
    <View
      testID="today-header"
      style={{
        flexDirection: cramped ? 'column' : 'row',
        alignItems: cramped ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: space.md,
        paddingHorizontal: cramped ? 0 : space.gutter,
        paddingVertical: space.md,
      }}
    >
      <View
        style={{
          flexDirection: cramped ? 'column' : 'row',
          alignItems: cramped ? 'flex-start' : 'center',
          gap: space.md,
          ...(cramped ? {} : { flex: 1 }),
        }}
      >
        <AvatarPair meName={me} partnerName={partner} />
        <View style={cramped ? undefined : { flex: 1 }}>
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
          leading={<Mascot mood={streak.data.completedToday ? 'together' : 'waiting'} size={24} />}
        />
      ) : null}
    </View>
  );
  const pinned = !cramped && actions;
  const content = (
    <>
      <OfflineBanner />
      {cramped ? null : header}
      <ScrollView
        testID="today-scroll"
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: space.sm,
          // Room under the last card so the little-things button never covers it.
          paddingBottom: littleThings && !pinned ? BUTTON_SIZE + BUTTON_INSET * 2 : space.gutter,
        }}
      >
        {/* #66: at AX5 on a short screen the header scrolls with the body instead of filling it. */}
        {cramped ? header : null}
        {/* D52: the day-3 gift while it's live (replaces the old win-back 36). */}
        {partnerJoined ? <GiftChip enabled={hasCouple} /> : null}
        {/* D36: while solo the code stays in sight (design addition, PO review). */}
        {couple.data && !partnerJoined ? (
          <>
            {/* BE-26: someone typed my code and waits for my yes (also shown on 10 and 11). */}
            <JoinRequestCards screenId="today" enabled style={{ marginBottom: space.lg }} />
            <SoloInviteCard partner={partner} />
          </>
        ) : null}
        {/* D56 (MOB-73): an offline answer that arrived after its day ended. */}
        {couple.data ? <DayEndedCard userId={userId} todayId={question.data?.id} /> : null}
        {body}
        {cramped && actions ? (
          <View style={{ paddingVertical: space.md }} testID="today-actions-inline">
            {actions}
          </View>
        ) : null}
      </ScrollView>
      {/* #33: pinned above the tab bar, never behind it (small phones, 200% text). */}
      {pinned ? (
        <View
          style={{ paddingHorizontal: space.gutter, paddingVertical: space.md }}
          onLayout={(e) => setActionsHeight(e.nativeEvent.layout.height)}
        >
          {actions}
        </View>
      ) : null}
    </>
  );
  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="today-screen"
    >
      {littleThings ? (
        <View
          style={{ flex: 1 }}
          // The open fan is a menu over Today: hide what's behind it from screen readers.
          importantForAccessibility={fanOpen ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={fanOpen}
        >
          {content}
        </View>
      ) : (
        content
      )}
      {littleThings && couple.data ? (
        <LittleThings
          partner={partner}
          coupleId={couple.data.id}
          bottom={(pinned ? actionsHeight : 0) + BUTTON_INSET}
          onOpenChange={setFanOpen}
        />
      ) : null}
      <BadgeUnlockedSheet
        days={unlocked}
        current={current}
        earned={earnedSteps ?? []}
        onDismiss={() => setUnlocked(null)}
      />
      <CheckInSheet visible={checkInOpen} onDismiss={() => setCheckInOpen(false)} />
    </SafeAreaView>
  );
}
