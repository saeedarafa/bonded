import { useRouter } from 'expo-router';
import { useEffect, useRef, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ReactionKind } from '@/features/daily/api';
import { DailyError, DailyLoading } from '@/features/daily/components/DailyFrame';
import { useTodayContext } from '@/features/daily/useTodayContext';
import {
  useMarkThreadRead,
  useSendMessage,
  useThread,
  useThreadItems,
  type ThreadItem,
} from '@/features/thread/hooks';
import { useTranslation } from '@/i18n';
import { usePartnerTyping, useTyping } from '@/lib/typing';
import { sendTypingSignal, useCoupleRealtime } from '@/lib/useCoupleRealtime';
import {
  AvatarPair,
  Button,
  ChatBubble,
  Composer,
  Icon,
  Mascot,
  OfflineBanner,
  personColors,
  Text,
  TopBar,
  TypingIndicator,
  useTheme,
  type IconName,
} from '@/ui';

const reactionIcons: Record<ReactionKind, IconName> = {
  love: 'heart',
  laugh: 'smile',
  spark: 'sparkle',
  wow: 'wow',
};

/**
 * 22 Thread for today's question. RLS opens it only once both have answered (and only inside the
 * pair period); the screen just shows what comes back. Messages are optimistic with a `client_id`
 * that a retry reuses. Typing is a broadcast (D15), never stored. No message text is logged.
 */
export default function ThreadScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space, radius, size } = useTheme();
  const ctx = useTodayContext();
  const id = ctx.question.data?.id;
  const coupleId = ctx.couple.data?.id;
  const userId = ctx.userId;
  const open = !!ctx.mine && ctx.partnerAnswered;
  const thread = useThread(id, { enabled: open });
  const items = useThreadItems(id, userId, thread.data);
  const { send, retry } = useSendMessage(id, userId);
  const partnerTyping = usePartnerTyping(id, userId);
  useCoupleRealtime(coupleId);
  useMarkThreadRead(id, userId, thread.data);
  const partner = ctx.partner;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/today'));

  // A new message from the partner: they stopped typing, and screen readers hear about it.
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const partnerCount = (thread.data ?? []).filter((m) => m.userId !== userId).length;
  const seenPartner = useRef<number | null>(null);
  useEffect(() => {
    if (!thread.data || !id) return;
    if (seenPartner.current !== null && partnerCount > seenPartner.current) {
      useTyping.getState().clear(id);
      AccessibilityInfo.announceForAccessibility(t('thread.newMessage', { partner }));
    }
    seenPartner.current = partnerCount;
  }, [partnerCount, thread.data, id, partner, t]);

  const bubble = (m: ThreadItem) => {
    const isMe = m.userId === userId;
    const theirs = m.reactions.filter((r) => r.userId !== m.userId);
    const pc = personColors(colors, !isMe);
    return (
      <View key={m.clientId} style={{ gap: space.xs }}>
        <ChatBubble
          testID={`22-message-${m.status}`}
          isMe={isMe}
          text={m.body}
          senderName={isMe ? t('today.you') : partner}
          status={m.status}
          {...(m.status === 'sending' ? { statusLabel: t('thread.sending') } : {})}
          {...(m.status === 'failed'
            ? { statusLabel: t('thread.notSent'), onRetry: () => retry(m.clientId) }
            : {})}
        />
        {theirs.map((r) => (
          <View
            key={r.id}
            accessible
            accessibilityLabel={t(`ui.reaction.${r.kind}`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              alignSelf: isMe ? 'flex-end' : 'flex-start',
              paddingHorizontal: space.sm,
              borderRadius: radius.pill,
              backgroundColor: colors.surface2,
            }}
          >
            <Icon
              name={reactionIcons[r.kind]}
              size={14}
              color={pc.text}
              filled={r.kind === 'love'}
            />
            <Text variant="caption" style={{ color: pc.text }}>
              {isMe ? partner : t('today.you')}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const loadError = ctx.error ?? thread.error;
  let body;
  if (ctx.question.data && !open) {
    // Not both answered: the thread isn't open yet (RLS would return nothing anyway).
    const answerFirst = !ctx.mine;
    body = (
      <View style={{ alignItems: 'center', gap: space.lg }} testID="22-not-ready">
        <Mascot mood="waiting" size={120} partnerName={partner} />
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {answerFirst
            ? t('daily.reveal.answerFirst', { partner })
            : t('daily.reveal.notYet', { partner })}
        </Text>
        <Button
          label={answerFirst ? t('daily.reveal.answerCta') : t('daily.backToToday')}
          onPress={() => router.replace(answerFirst ? '/today/answer' : '/today')}
        />
      </View>
    );
  } else if (loadError) {
    body = (
      <DailyError
        error={loadError}
        fallback={t('thread.loadError')}
        onRetry={() => {
          ctx.refetch();
          void thread.refetch();
        }}
        testID="22-load-error"
      />
    );
  } else if (!thread.data) {
    body = <DailyLoading testID="22-loading" />;
  } else {
    body = (
      <View style={{ flex: 1, justifyContent: 'flex-end', gap: space.md }} testID="22-messages">
        {items.length === 0 ? (
          <Text tone="text3" style={{ textAlign: 'center' }} testID="22-empty">
            {t('thread.empty', { partner })}
          </Text>
        ) : (
          items.map(bubble)
        )}
        {partnerTyping ? <TypingIndicator name={partner} testID="22-typing" /> : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="22-screen">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <OfflineBanner />
        <TopBar
          testID="22-screen-top"
          onBack={back}
          center={
            <View style={{ flex: 1 }}>
              <Text variant="label" accessibilityRole="header">
                {t('thread.title')}
              </Text>
              {ctx.question.data ? (
                <Text variant="caption" tone="text2">
                  {ctx.question.data.question}
                </Text>
              ) : null}
            </View>
          }
        />
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          // #32: a drag on the messages closes the keyboard (small phones).
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={{
            flexGrow: 1,
            gap: space.md,
            padding: space.gutter,
            paddingTop: space.sm,
          }}
        >
          {open ? (
            <Pressable
              testID="22-answers"
              accessibilityRole="button"
              onPress={() => router.push('/today/revealed')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                minHeight: size.tapTarget,
                paddingHorizontal: space.md,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surface,
              }}
            >
              <AvatarPair meName={ctx.me} partnerName={partner} size="sm" />
              <Text variant="label" tone="text2" style={{ flex: 1 }}>
                {t('thread.bothAnswers')}
              </Text>
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <Icon name="back" size={18} color={colors.text2} />
              </View>
            </Pressable>
          ) : null}
          {body}
        </ScrollView>
        {open && thread.data ? (
          <View style={{ paddingHorizontal: space.gutter, paddingBottom: space.md }}>
            <Composer
              testID="22-composer"
              placeholder={t('thread.reply', { partner })}
              onSend={send}
              onTyping={() => {
                if (coupleId && id && userId) {
                  sendTypingSignal(coupleId, { user_id: userId, couple_question_id: id });
                }
              }}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
