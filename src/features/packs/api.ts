import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Packs (MOB-20, CONTRACTS §2 "Packs"). RLS returns active packs only. Question bodies are content,
 * not user text. Access is the server's: `start_pack_question` raises `PREMIUM_REQUIRED` (it checks
 * `private.is_couple_premium()`); nothing here decides it.
 */

export type PackSummary = {
  id: string;
  slug: string;
  title: string;
  description: string;
  isPremium: boolean;
  icon: string | null;
  questionCount: number;
};

export type PackQuestion = { id: string; position: number; body: string };
export type PackDetail = Omit<PackSummary, 'questionCount'> & { questions: PackQuestion[] };

// D33: no 18+ pack at launch. The loader already deactivates it (RLS then hides it); this keeps a
// stray row out of the grid too. Content rating, not security.
const launchable = (p: { age_gate: string | null }) => p.age_gate === null;

/** Board 32: every pack with its question count (no question text). */
export async function getPacks(): Promise<PackSummary[]> {
  const rows = unwrap(
    await supabase
      .from('question_packs')
      .select('id, slug, title, description, is_premium, icon, age_gate, pack_questions(count)')
      .order('sort_order'),
  );
  return (rows ?? []).filter(launchable).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    isPremium: p.is_premium,
    icon: p.icon,
    questionCount: p.pack_questions?.[0]?.count ?? 0,
  }));
}

/** Board 33: one pack and its questions in order. Null when it is gone (inactive or unknown). */
export async function getPack(packId: string): Promise<PackDetail | null> {
  const row = unwrap(
    await supabase
      .from('question_packs')
      .select(
        'id, slug, title, description, is_premium, icon, age_gate, pack_questions(position, question:questions(id, body))',
      )
      .eq('id', packId)
      .maybeSingle(),
  );
  if (!row || !launchable(row)) return null;
  const questions = (row.pack_questions ?? [])
    // RLS hides an inactive question: its row has no `question`.
    .flatMap((pq) =>
      pq.question ? [{ id: pq.question.id, position: pq.position, body: pq.question.body }] : [],
    )
    .sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    isPremium: row.is_premium,
    icon: row.icon,
    questions,
  };
}

/** Analytics only (MOB-24c, `pack_id`): the pack a question belongs to (the first one), or null. */
export async function getPackIdOfQuestion(questionId: string): Promise<string | null> {
  const row = unwrap(
    await supabase
      .from('pack_questions')
      .select('pack_id')
      .eq('question_id', questionId)
      .limit(1)
      .maybeSingle(),
  );
  return row?.pack_id ?? null;
}

/**
 * `start_pack_question(p_question)`: the couple's `couple_questions` row for it (idempotent).
 * Raises `PREMIUM_REQUIRED`, `QUESTION_UNAVAILABLE` or `NOT_PAIRED` as AppError.
 */
export async function startPackQuestion(questionId: string): Promise<string> {
  const row = unwrap(await supabase.rpc('start_pack_question', { p_question: questionId }));
  if (!row?.id) throw new Error('start_pack_question returned no row');
  return row.id;
}

/**
 * D51 lead default: pack questions a free couple already started stay answerable. Of the given
 * question ids, the ones this couple has a `couple_questions` row for (RLS: my couple only), as
 * question id -> couple_questions id. Ids only, no text.
 */
export async function getStartedPackQuestions(
  questionIds: string[],
): Promise<Record<string, string>> {
  if (questionIds.length === 0) return {};
  const rows = unwrap(
    await supabase
      .from('couple_questions')
      .select('id, question_id')
      .in('question_id', questionIds),
  );
  // A plain object, not a Map: the query cache is persisted as JSON.
  return Object.fromEntries((rows ?? []).map((r) => [r.question_id, r.id]));
}
