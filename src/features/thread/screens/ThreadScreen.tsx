import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  type AccessibilityActionEvent,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useQuestionRef } from '@/features/daily/analytics';
import { DailyError, DailyLoading, keyboardBehavior } from '@/features/daily/components/DailyFrame';
import { localDateKey } from '@/features/daily/today';
import { useTodayContext } from '@/features/daily/useTodayContext';
import { HistoryUnlock } from '@/features/history/components/HistoryLock';
import { useHistoryDetail } from '@/features/history/hooks';
import { ThreadComposer } from '@/features/thread/components/ThreadComposer';
import {
  useMarkThreadRead,
  useMessageReaction,
  useSendMessage,
  useThread,
  useThreadItems,
  useThreadUnread,
  type ThreadItem,
} from '@/features/thread/hooks';
import { VoiceNote } from '@/features/voice/components/VoiceNote';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { usePartnerTyping, useTyping } from '@/lib/typing';
import { sendTypingSignal, useCoupleRealtime } from '@/lib/useCoupleRealtime';
import {
  AvatarPair,
  Button,
  ChatBubble,
  EmojiPicker,
  emojiName,
  haptics,
  Icon,
  Mascot,
  myReaction,
  nextReaction,
  normalizeReaction,
  OfflineBanner,
  personColors,
  Text,
  TopBar,
  TypingIndicator,
  useTheme,
  useToast,
  TITLE_MAX_FONT_SCALE,
} from '@/ui';

/**
 * 22 Thread for today's question, or for a past one at `/history/<id>/thread` (MOB-16). RLS opens it only once both have answered (and only inside the
 * pair period); the screen just shows what comes back. Messages are optimistic with a `client_id`
 * that a retry reuses. Typing is a broadcast (D15), never stored. No message text is logged.
 * Voice messages (22b, D46, MOB-56) mix with text: anyone plays them, Premium couples record them
 * (behind `SHIPPED.voice`, see `ThreadComposer`).
 */
export default function ThreadScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space, radius, size } = useTheme();
  const ctx = useTodayContext();
  // A past question (History): who answered comes from its history detail, not from today.
  const { questionId } = useLocalSearchParams<{ questionId?: string }>();
  const past = useHistoryDetail(questionId);
  const coupleId = ctx.couple.data?.id;
  const userId = ctx.userId;
  const id = questionId ?? ctx.question.data?.id;
  const questionText = questionId ? past.data?.question : ctx.question.data?.question;
  const pastMine = !!userId && !!past.data?.answeredBy.includes(userId);
  const mine = questionId ? pastMine : !!ctx.mine;
  const partnerAnswered = questionId
    ? !!past.data && past.data.answerCount - (pastMine ? 1 : 0) >= 1
    : ctx.partnerAnswered;
  const known = questionId ? past.data !== undefined : !!ctx.question.data;
  // MOB-71 (D55): an older day's thread is Premium, like its answers (the server returns nothing).
  const locked = !!questionId && !!past.data?.locked;
  const open = mine && partnerAnswered && !locked;
  const thread = useThread(id, { enabled: open });
  const items = useThreadItems(id, userId, thread.data);
  // Analytics (MOB-24c, §3.5): ids and counts only.
  const questionRef = useQuestionRef(questionId ? past.data : ctx.question.data);
  const unread = useThreadUnread(open ? id : undefined, userId);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !open || !questionRef || unread.data === undefined) return;
    opened.current = true;
    track('thread_opened', { question_id: questionRef.question_id, unread_count: unread.data });
  }, [open, questionRef, unread.data]);
  const { send, sendVoice, retry } = useSendMessage(id, userId, {
    questionId: questionRef?.question_id,
    // A voice message that failed for a reason a retry won't fix by itself (e.g. the day's limit).
    onError: (error, item) => {
      if (item.voice && error.kind !== 'NETWORK') useToast.getState().show(error.message, 'error');
    },
  });
  const partnerTyping = usePartnerTyping(id, userId);
  useCoupleRealtime(coupleId);
  useMarkThreadRead(id, userId, thread.data);
  const reactToMessage = useMessageReaction(id);
  // D45: the message whose emoji picker is open (long-press on a partner's message).
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const picking = pickingFor ? items.find((m) => m.id === pickingFor) : undefined;
  const react = (messageId: string, kind: string | null) => {
    if (!userId) return;
    reactToMessage.mutate(
      { messageId, userId, kind },
      { onError: (e) => useToast.getState().show(e.message, 'error') },
    );
  };
  const partner = ctx.partner;
  // #280: "Today's thread" only for today's daily question. Opened by id, a past daily day or a
  // pack question gets the neutral "Thread" (like #270 on 19); no title while the row loads.
  const title = !questionId
    ? t('thread.title')
    : !past.data
      ? undefined
      : past.data.source === 'daily' &&
          past.data.assignedFor !== null &&
          past.data.assignedFor === localDateKey(new Date(), ctx.couple.data?.timezone)
        ? t('thread.title')
        : t('thread.pastTitle');
  const home = questionId ? (`/history/${questionId}` as const) : ('/today' as const);
  const back = () => (router.canGoBack() ? router.back() : router.replace(home));

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
    // Reactions need a message the server has (an id); my own messages aren't reacted to here.
    const canReact = !isMe && m.status === 'sent' && !!userId;
    return (
      <View key={m.clientId} style={{ gap: space.xs }}>
        <ChatBubble
          testID={`22-message-${m.status}`}
          isMe={isMe}
          text={m.body}
          {...(m.voice
            ? {
                media: (
                  <VoiceNote
                    testID={`22b-voice-${m.clientId}`}
                    kind="message"
                    isMe={isMe}
                    source={m.voice.path ? { path: m.voice.path } : { uri: m.voice.fileUri ?? '' }}
                    durationMs={m.voice.durationMs}
                    accessibilityHint={[
                      isMe ? t('thread.voice.fromMe') : t('thread.voice.fromPartner', { partner }),
                      m.status === 'sending' ? t('thread.sending') : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    {...(canReact
                      ? {
                          accessibilityActions: [{ name: 'react', label: t('ui.reaction.action') }],
                          onAccessibilityAction: (e: AccessibilityActionEvent) => {
                            if (e.nativeEvent.actionName === 'react') setPickingFor(m.id);
                          },
                        }
                      : {})}
                  />
                ),
              }
            : {})}
          senderName={isMe ? t('today.you') : partner}
          status={m.status}
          {...(m.status === 'sending' ? { statusLabel: t('thread.sending') } : {})}
          {...(m.status === 'failed'
            ? { statusLabel: t('thread.notSent'), onRetry: () => retry(m.clientId) }
            : {})}
          {...(canReact
            ? {
                onReact: () => {
                  haptics.light();
                  setPickingFor(m.id);
                },
                reactLabel: t('ui.reaction.action'),
                reactHint: t('thread.reactHint'),
              }
            : {})}
        />
        {m.reactions.map((r) => {
          const kind = normalizeReaction(r.kind);
          const mine = r.userId === userId;
          const pc = personColors(colors, mine);
          const chip = {
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            gap: space.xs,
            alignSelf: isMe ? ('flex-end' as const) : ('flex-start' as const),
            paddingHorizontal: space.sm,
            borderRadius: radius.pill,
            backgroundColor: colors.surface2,
          };
          const content = (
            <>
              <Text variant="label">{kind}</Text>
              <Text variant="caption" style={{ color: pc.text }}>
                {mine ? t('today.you') : partner}
              </Text>
            </>
          );
          return mine ? (
            <Pressable
              key={r.id}
              testID="22-reaction-mine"
              accessibilityRole="button"
              accessibilityLabel={t('ui.reaction.removeMine', { name: emojiName(kind) })}
              onPress={() => react(m.id, null)}
              style={{ ...chip, minHeight: size.tapTarget, minWidth: size.tapTarget }}
            >
              {content}
            </Pressable>
          ) : (
            <View
              key={r.id}
              testID="22-reaction-partner"
              accessible
              accessibilityLabel={t('ui.reaction.by', { who: partner, name: emojiName(kind) })}
              style={chip}
            >
              {content}
            </View>
          );
        })}
      </View>
    );
  };

  const loadError = (questionId ? (past.error ?? ctx.couple.error) : ctx.error) ?? thread.error;
  let body;
  if (locked) {
    body = (
      <View style={{ alignItems: 'center', gap: space.lg }} testID="22-locked">
        <Mascot mood="saving-a-seat" size={120} partnerName={partner} />
        <HistoryUnlock testID="22-unlock" body={t('history.locked.threadBody')} />
      </View>
    );
  } else if (known && !open && questionId) {
    // A past question you didn't both answer: its thread never opened.
    body = (
      <View style={{ alignItems: 'center', gap: space.lg }} testID="22-not-ready">
        <Mascot mood="waiting" size={120} partnerName={partner} />
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('history.past.threadLocked')}
        </Text>
        <Button label={t('ui.back')} onPress={back} />
      </View>
    );
  } else if (known && !open) {
    // Not both answered: the thread isn't open yet (RLS would return nothing anyway).
    const answerFirst = !mine;
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
          if (questionId) void past.refetch();
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={keyboardBehavior(Platform.OS).behavior}>
        <OfflineBanner />
        <TopBar
          testID="22-screen-top"
          onBack={back}
          center={
            // #356: like 19/21 the header stops at 200%, so at AX5 it wraps instead of being cut
            // and the messages keep room to scroll. No `flex: 1` here (MOB-80b): in the bar's
            // auto-height column it means a 0 basis, so the bar stayed 56 pt and the question
            // subtitle drew below it, under the messages. Sized by its content, the bar grows.
            <View style={{ alignSelf: 'stretch' }}>
              {title ? (
                <Text
                  variant="label"
                  accessibilityRole="header"
                  maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
                >
                  {title}
                </Text>
              ) : null}
              {questionText ? (
                <Text variant="caption" tone="text2" maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}>
                  {questionText}
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
              onPress={() => (questionId ? back() : router.push('/today/revealed'))}
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
              {/* #367: capped at 200% so "Both answers" wraps between words at AX5. */}
              <Text
                variant="label"
                tone="text2"
                maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
                style={{ flex: 1 }}
              >
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
            <ThreadComposer
              coupleId={coupleId}
              userId={userId}
              partner={partner}
              onSend={send}
              onSendVoice={sendVoice}
              onTyping={() => {
                if (coupleId && id && userId) {
                  sendTypingSignal(coupleId, { user_id: userId, couple_question_id: id });
                }
              }}
            />
          </View>
        ) : null}
        <EmojiPicker
          testID="22-picker"
          visible={!!picking}
          current={picking ? myReaction(picking.reactions, userId) : null}
          onDismiss={() => setPickingFor(null)}
          onPick={(emoji) => {
            if (picking)
              react(picking.id, nextReaction(myReaction(picking.reactions, userId), emoji));
            setPickingFor(null);
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
