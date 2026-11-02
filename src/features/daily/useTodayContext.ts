import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { useTodayQuestion } from '@/features/daily/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';

/**
 * What screens 19, 20 and 21 share: me, my partner's name, today's question and who has answered.
 * No answer text here (CONTRACTS §2: "partner status for a question" needs no text).
 */
export function useTodayContext() {
  const { t } = useTranslation();
  const { userId } = useSession();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  const question = useTodayQuestion({ enabled: !!couple.data });

  const me = profiles.me?.display_name?.trim() || t('today.you');
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const mine = question.data?.answers.find((a) => a.userId === userId) ?? null;
  const partnerAnswered = question.data ? question.data.answerCount - (mine ? 1 : 0) >= 1 : false;

  return {
    userId,
    couple,
    question,
    me,
    partner,
    /** My answer (id and time only), or null. */
    mine,
    partnerAnswered,
    error: couple.error ?? question.error,
    refetch: () => {
      void couple.refetch();
      void question.refetch();
    },
  };
}
