import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { DailyError, DailyFrame, DailyLoading } from '@/features/daily/components/DailyFrame';
import { useTodayContext } from '@/features/daily/useTodayContext';
import { useTranslation } from '@/i18n';
import { useDrafts } from '@/lib/drafts';

export type QuestionTarget =
  | '/'
  | '/today'
  | '/today/answer'
  | '/today/reveal'
  | '/today/revealed'
  | '/today/thread'
  | `/history/${string}`;

/**
 * Where `bonded://question/<id>` (or `/thread`) lands (CONTRACTS §5, deeplinks.json). Today's
 * question opens by answer state: 19 to answer, 23 waiting, 20 to reveal, 21 once revealed on this
 * device. Any other question opens its history entry (30). Pure, so it is tested per state.
 */
export function questionTarget(input: {
  linkId: string;
  thread: boolean;
  hasCouple: boolean;
  todayId: string | null;
  answered: boolean;
  partnerAnswered: boolean;
  revealedHere: boolean;
}): QuestionTarget {
  if (!input.hasCouple) return '/';
  if (input.todayId !== input.linkId) return `/history/${input.linkId}`;
  if (input.thread) return '/today/thread';
  if (!input.answered) return '/today/answer';
  if (!input.partnerAnswered) return '/today';
  return input.revealedHere ? '/today/revealed' : '/today/reveal';
}

/** Route `/question/[id]` and `/question/[id]/thread`: loads today, then replaces itself. */
export function QuestionLinkScreen({ thread }: { thread: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useTodayContext();
  const revealed = useDrafts((s) => s.revealed);
  const linkId = (id ?? '').toLowerCase();

  const coupleKnown = ctx.couple.data !== undefined;
  // Wait for a fresh fetch: the push is newer than the cache (offline, a paused fetch counts as done).
  const ready =
    coupleKnown &&
    (ctx.couple.data === null || (ctx.question.data !== undefined && !ctx.question.isFetching));
  if (ready) {
    const todayId = ctx.question.data?.id.toLowerCase() ?? null;
    const href = questionTarget({
      linkId,
      thread,
      hasCouple: !!ctx.couple.data,
      todayId,
      answered: !!ctx.mine,
      partnerAnswered: ctx.partnerAnswered,
      revealedHere: !!ctx.question.data && revealed.includes(ctx.question.data.id),
    });
    return <Redirect href={href} />;
  }

  return (
    <DailyFrame
      testID="question-link"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
    >
      {ctx.error ? (
        <DailyError
          testID="question-link-error"
          error={ctx.error}
          fallback={t('today.loadError')}
          onRetry={ctx.refetch}
        />
      ) : (
        <DailyLoading testID="question-link-loading" />
      )}
    </DailyFrame>
  );
}
