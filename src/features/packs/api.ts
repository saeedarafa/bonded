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

/**
 * `start_pack_question(p_question)`: the couple's `couple_questions` row for it (idempotent).
 * Raises `PREMIUM_REQUIRED`, `QUESTION_UNAVAILABLE` or `NOT_PAIRED` as AppError.
 */
export async function startPackQuestion(questionId: string): Promise<string> {
  const row = unwrap(await supabase.rpc('start_pack_question', { p_question: questionId }));
  if (!row?.id) throw new Error('start_pack_question returned no row');
  return row.id;
}
