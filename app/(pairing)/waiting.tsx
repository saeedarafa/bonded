import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActiveCouple } from '@/features/couple/hooks';
import { useTodayQuestion } from '@/features/daily/hooks';
import { dayNumber, togetherSince } from '@/features/daily/today';
import { JoinRequestCards } from '@/features/pairing/components/JoinRequestCards';
import { JOIN_FROM_SOLO_ENABLED } from '@/features/pairing/flags';
import { hoursSinceInvite } from '@/features/pairing/analytics';
import { useOpenInvite, usePartnerJoined } from '@/features/pairing/hooks';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { Banner, Button, Mascot, QuestionCard, Skeleton, Text, useTheme } from '@/ui';

/** 11 Waiting, answer first: the partner hasn't joined. Moves on by itself when they do. */
export default function PairingWaitingRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const couple = useActiveCouple();
  const { joined } = usePartnerJoined();
  // #36: the board shows today's (day-1) question here, so "already here" is true.
  const question = useTodayQuestion({ enabled: !!couple.data && !joined });
  // Analytics (MOB-24d, §3.4): once per visit, when the open invite says how old it is.
  const open = useOpenInvite(!joined);
  const viewed = useRef(false);
  const hours = hoursSinceInvite(open.data?.expiresAt);
  useEffect(() => {
    if (viewed.current || joined || hours === null) return;
    viewed.current = true;
    track('pair_waiting_viewed', { hours_since_invite: hours });
  }, [hours, joined]);

  if (joined) return <Redirect href="/paired" />;
  if (couple.data === null) return <Redirect href="/" />;

  const partner = couple.data?.partner_name?.trim() || t('pairing.partnerFallback');

  let card = null;
  if (question.data && couple.data) {
    card = (
      <QuestionCard
        testID="11-question"
        dayLabel={t('pairing.waiting.dayLabel', {
          n: dayNumber(togetherSince(couple.data), new Date(), couple.data.timezone),
        })}
        question={question.data.question}
      >
        <Text variant="caption" tone="text3">
          {t('pairing.waiting.partnerAnswer', { partner })}
        </Text>
      </QuestionCard>
    );
  } else if (question.error) {
    card = (
      <View style={{ gap: space.sm }} testID="11-question-error">
        <Banner
          tone="error"
          message={question.error.message || t('pairing.waiting.questionError')}
        />
        <Button variant="link" label={t('ui.retry')} onPress={() => void question.refetch()} />
      </View>
    );
  } else if (couple.data) {
    card = <Skeleton height={140} testID="11-question-loading" />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="11-screen">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          padding: space.gutter,
          paddingTop: space.hero,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.lg }}>
          <Mascot
            mood="waiting"
            size={160}
            partnerName={partner}
            accessibilityLabel={t('pairing.waiting.mascot', { partner })}
          />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.waiting.title', { partner })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.waiting.body')}
          </Text>
          {couple.error ? <Banner tone="error" message={couple.error.message} /> : null}
          {/* BE-26: someone typed my code and waits for my yes. */}
          <JoinRequestCards screenId="11" enabled={!!couple.data && !joined} />
        </View>
        {card}
        <View style={{ gap: space.md }}>
          <Button
            testID="11-answer"
            label={t('pairing.waiting.answerFirst')}
            onPress={() => router.push('/today')}
          />
          <Button
            testID="11-resend"
            variant="ghost"
            label={t('pairing.waiting.resend')}
            onPress={() => router.push('/invite')}
          />
          {/* D37: their partner already sent a code; join it instead of waiting here. */}
          {JOIN_FROM_SOLO_ENABLED ? (
            <Button
              testID="11-join-partner"
              variant="link"
              label={t('pairing.joinPartner.cta')}
              onPress={() => router.push('/join/code')}
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
