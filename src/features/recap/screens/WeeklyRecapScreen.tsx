import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { DailyError } from '@/features/daily/components/DailyFrame';
import { localDateKey } from '@/features/daily/today';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { useDrafts } from '@/lib/drafts';
import { useCoupleRealtime } from '@/lib/useCoupleRealtime';
import {
  Avatar,
  Button,
  Icon,
  Mascot,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  TopBar,
  useTheme,
  type MascotMood,
} from '@/ui';

import { useLovedAnswer, useLovedAnswerBody, useRecapWeek, useWeeklyRecap } from '../hooks';
import {
  lovedTextAllowed,
  recapDays,
  weekdayLetter,
  weekdayName,
  weekRangeLabel,
  weekStartOf,
  type RecapDay,
  type RecapDayState,
} from '../model';

const STRIP_MASCOT = 36;

const MOOD: Partial<Record<RecapDayState, MascotMood>> = {
  both: 'together',
  one: 'waiting',
  missed: 'napping',
};

/**
 * 31 Weekly recap (MOB-21 part 2, D21, BE-14): this couple-local week, Monday to Sunday. Free
 * shows days together only; replies, reactions and the most-loved answer come from the server
 * only when it says the couple is premium (`is_full`). The Sunday push lands here. The
 * most-loved answer's text follows the reveal rule (`lovedTextAllowed`); no text is logged.
 */
export default function WeeklyRecapScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colors, space, radius } = useTheme();
  const { userId } = useSession();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  const coupleId = couple.data?.id;
  useCoupleRealtime(coupleId);
  const locale = i18n.language || 'en';

  const today = localDateKey(new Date(), couple.data?.timezone);
  const weekStart = weekStartOf(today);
  const recap = useWeeklyRecap(coupleId, weekStart);
  const week = useRecapWeek(coupleId, weekStart);
  const lovedId = recap.data?.isFull ? recap.data.mostLovedAnswerId : null;
  const loved = useLovedAnswer(lovedId);
  const revealedHere = useDrafts(
    (s) => !!loved.data && s.revealed.includes(loved.data.coupleQuestionId),
  );
  const textAllowed =
    !!loved.data &&
    lovedTextAllowed({
      source: loved.data.source,
      assignedFor: loved.data.assignedFor,
      today,
      revealedHere,
    });
  const lovedBody = useLovedAnswerBody(lovedId, textAllowed);

  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const meName = profiles.me?.display_name?.trim() || t('history.recap.you');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/history'));
  const range = weekRangeLabel(weekStart, locale);

  const error = couple.error ?? recap.error ?? week.error;
  const loading =
    !error &&
    (couple.data === undefined ||
      (coupleId !== undefined && (recap.data === undefined || week.data === undefined)));

  let body;
  if (error) {
    body = (
      <DailyError
        error={error}
        fallback={t('history.recap.loadError')}
        onRetry={() => {
          void couple.refetch();
          void recap.refetch();
          void week.refetch();
        }}
        testID="31-error"
      />
    );
  } else if (loading) {
    body = (
      <SkeletonGroup testID="31-loading">
        <Skeleton height={32} width="70%" />
        <Skeleton height={76} />
        <Skeleton height={76} />
        <Skeleton height={120} />
      </SkeletonGroup>
    );
  } else {
    const r = recap.data ?? {
      daysTogether: 0,
      replies: null,
      reactions: null,
      mostLovedAnswerId: null,
      isFull: false,
    };
    const days = recapDays({ weekStart, today, days: week.data ?? [] });
    const card = {
      backgroundColor: colors.surface,
      borderColor: colors.line,
      borderWidth: 1,
      borderRadius: radius.card,
      padding: space.lg,
      gap: space.sm,
    } as const;

    const lovedBy = loved.data
      ? t('history.recap.mostLovedBy', {
          name: loved.data.userId === userId ? t('history.recap.you') : partner,
          day: weekdayName(
            loved.data.assignedFor ??
              localDateKey(new Date(loved.data.createdAt), couple.data?.timezone),
            locale,
          ),
        })
      : '';
    const lovedCard = !r.isFull ? null : lovedId === null ? (
      <View style={card} testID="31-no-loved">
        <Text variant="caption" tone="text2">
          {t('history.recap.mostLoved')}
        </Text>
        <Text tone="text2">{t('history.recap.noMostLoved')}</Text>
      </View>
    ) : loved.error || lovedBody.error ? (
      <DailyError
        error={(loved.error ?? lovedBody.error)!}
        fallback={t('history.recap.loadError')}
        onRetry={() => {
          void loved.refetch();
          if (textAllowed) void lovedBody.refetch();
        }}
        testID="31-loved-error"
      />
    ) : loved.data === undefined || (textAllowed && lovedBody.data === undefined) ? (
      <Skeleton height={120} testID="31-loved-loading" />
    ) : loved.data === null ? null : (
      <View style={card} testID="31-loved">
        <Text variant="caption" tone="text2">
          {t('history.recap.mostLoved')}
        </Text>
        {textAllowed && lovedBody.data ? (
          <Text testID="31-loved-body">{`“${lovedBody.data}”`}</Text>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text tone="text2" testID="31-loved-hidden">
              {t('history.recap.mostLovedHidden')}
            </Text>
            <Button
              testID="31-loved-open"
              variant="ghost"
              label={t('history.recap.mostLovedOpen')}
              onPress={() =>
                router.push(
                  loved.data?.source === 'daily' && loved.data.assignedFor === today
                    ? '/today'
                    : `/history/${loved.data?.coupleQuestionId ?? ''}`,
                )
              }
            />
          </View>
        )}
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
          accessible
          accessibilityLabel={`${lovedBy}. ${t('history.recap.mostLovedHearts', { count: loved.data.hearts })}`}
        >
          <Avatar
            size="sm"
            name={loved.data.userId === userId ? meName : partner}
            isMe={loved.data.userId === userId}
          />
          <Text variant="caption" tone="text2" style={{ flex: 1 }} testID="31-loved-by">
            {lovedBy}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="heart" size={14} color={colors.youText} filled />
            <Text variant="label" tone="youText" style={{ fontVariant: ['tabular-nums'] }}>
              {String(loved.data.hearts)}
            </Text>
          </View>
        </View>
      </View>
    );

    body = (
      <View style={{ gap: space.md }}>
        <Text variant="h1" accessibilityRole="header" testID="31-title">
          {t('history.recap.title')}
        </Text>
        <View
          testID="31-strip"
          style={[
            card,
            { flexDirection: 'row', justifyContent: 'space-between', padding: space.md },
          ]}
        >
          {days.map((d) => (
            <StripDay key={d.date} day={d} locale={locale} partner={partner} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <StatTile
            testID="31-days"
            value={t('history.recap.daysTogether', { n: r.daysTogether })}
            label={t('history.recap.daysTogetherLabel')}
            a11y={t('history.recap.daysTogetherA11y', { n: r.daysTogether })}
            accent
          />
          {r.isFull ? (
            <>
              <StatTile
                testID="31-replies"
                value={String(r.replies ?? 0)}
                label={t('history.recap.replies')}
                a11y={t('history.recap.statA11y', {
                  n: r.replies ?? 0,
                  label: t('history.recap.replies'),
                })}
              />
              <StatTile
                testID="31-reactions"
                value={String(r.reactions ?? 0)}
                label={t('history.recap.reactions')}
                a11y={t('history.recap.statA11y', {
                  n: r.reactions ?? 0,
                  label: t('history.recap.reactions'),
                })}
              />
            </>
          ) : null}
        </View>
        {r.isFull ? (
          lovedCard
        ) : (
          <View style={card} testID="31-premium">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="lock" size={20} color={colors.premiumText} />
              <Text variant="h2" style={{ flex: 1 }}>
                {t('history.recap.premiumTitle')}
              </Text>
            </View>
            <Text tone="text2">{t('history.recap.premiumBody')}</Text>
            <Button
              testID="31-premium-cta"
              variant="premium"
              label={t('history.recap.premiumCta')}
              onPress={() => router.push({ pathname: '/paywall', params: { from: 'recap' } })}
            />
          </View>
        )}
        <View
          testID="31-later"
          accessible
          style={[card, { borderStyle: 'dashed', backgroundColor: 'transparent' }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="sparkle" size={20} color={colors.premiumText} />
            <Text variant="h2" style={{ flex: 1 }}>
              {t('history.recap.laterTitle')}
            </Text>
          </View>
          <Text tone="text2">{t('history.recap.laterBody')}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="31-screen">
      <OfflineBanner />
      <TopBar
        testID="31-top"
        onBack={back}
        right={
          <Text
            variant="caption"
            tone="text2"
            testID="31-range"
            accessibilityLabel={t('history.recap.rangeA11y', { range })}
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {range}
          </Text>
        }
      />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space.gutter, paddingTop: space.sm }}
      >
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function StripDay({ day, locale, partner }: { day: RecapDay; locale: string; partner: string }) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const mood = MOOD[day.state];
  return (
    <View
      testID={`31-day-${day.date}`}
      accessible
      accessibilityLabel={t(`history.recap.day.${day.state}`, {
        day: weekdayName(day.date, locale),
      })}
      style={{ alignItems: 'center', gap: space.xs, flex: 1 }}
    >
      {mood ? (
        <Mascot mood={mood} size={STRIP_MASCOT} partnerName={partner} />
      ) : (
        <View
          testID={`31-day-${day.date}-empty`}
          style={{
            width: STRIP_MASCOT,
            height: STRIP_MASCOT,
            borderRadius: STRIP_MASCOT / 2,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: day.state === 'today' ? colors.youText : colors.line,
          }}
        />
      )}
      <Text variant="caption" tone="text2" maxFontSizeMultiplier={1.5}>
        {weekdayLetter(day.date, locale)}
      </Text>
    </View>
  );
}

function StatTile({
  value,
  label,
  a11y,
  accent = false,
  testID,
}: {
  value: string;
  label: string;
  a11y: string;
  accent?: boolean;
  testID: string;
}) {
  const { colors, space, radius } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={a11y}
      style={{
        flex: 1,
        alignItems: 'center',
        padding: space.md,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <Text
        variant="number"
        tone={accent ? 'youText' : 'text'}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
      <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}
