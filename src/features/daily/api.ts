import { AppError, messageFor, toAppError, unwrap, type MessageOptions } from '@/lib/errors';
import { bodyOrVoice } from '@/features/voice/placeholder';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

import type { RawStreak } from './today';

/** Today's question for the Today tab. Answer text is never selected here (ids and times only). */
export type TodayQuestion = {
  id: string;
  answerCount: number;
  question: string;
  /** Answers RLS lets me see (mine; the partner's only once I've answered): who and when. */
  answers: { userId: string; createdAt: string }[];
};

const unknown = () => new AppError('UNKNOWN', messageFor('UNKNOWN'));

/**
 * `get_daily_question()` assigns (or returns) today's `couple_questions` row; the detail select adds
 * the question and who has answered. A locked partner answer is absent: `answerCount` still counts it.
 */
export async function getTodayQuestion(): Promise<TodayQuestion> {
  const row = unwrap(await supabase.rpc('get_daily_question'));
  if (!row?.id) throw unknown();
  const detail = unwrap(
    await supabase
      .from('couple_questions')
      .select('id, answer_count, question:questions(body), answers(user_id, created_at)')
      .eq('id', row.id)
      .single(),
  );
  if (!detail) throw unknown();
  return {
    id: detail.id,
    answerCount: detail.answer_count,
    question: detail.question?.body ?? '',
    answers: (detail.answers ?? []).map((a) => ({ userId: a.user_id, createdAt: a.created_at })),
  };
}

/**
 * D45 (BE-40): `reactions.kind` is exactly one system emoji; the database validates it and raises
 * `INVALID_REACTION` otherwise. A bare ❤ is stored as ❤️ (see `normalizeReaction`).
 */
export type ReactionKind = Database['public']['Tables']['reactions']['Row']['kind'];

export type Reaction = { id: string; userId: string; kind: ReactionKind };

/** A voice answer's object in bucket `voice` (D46). Played through a fresh 60 s signed URL. */
export type VoiceRef = { path: string; durationMs: number };

export type RevealedAnswer = {
  id: string;
  userId: string;
  /** The text, or the neutral "Voice note" for a voice answer (see `voice`). */
  body: string;
  /** Set for a voice answer (`kind = 'voice'`); null or absent for text. */
  voice?: VoiceRef | null;
  createdAt: string;
  reactions: Reaction[];
};

/** A question with every answer RLS lets me read, with their reactions (screen 21). */
export type RevealedQuestion = {
  id: string;
  answerCount: number;
  question: string;
  answers: RevealedAnswer[];
};

/**
 * The ONLY select that reads answer text. Call it only once my own answer exists (the hooks gate
 * it on that); RLS is still the source of truth: before I've answered, the partner's row is simply
 * absent, and so are reactions on it.
 */
export async function getRevealedQuestion(coupleQuestionId: string): Promise<RevealedQuestion> {
  const detail = unwrap(
    await supabase
      .from('couple_questions')
      .select(
        'id, answer_count, question:questions(body), answers(id, user_id, body, kind, voice_path, voice_duration_ms, created_at, reactions(id, user_id, kind))',
      )
      .eq('id', coupleQuestionId)
      .single(),
  );
  if (!detail) throw unknown();
  return {
    id: detail.id,
    answerCount: detail.answer_count,
    question: detail.question?.body ?? '',
    answers: (detail.answers ?? []).map((a) => ({
      id: a.id,
      userId: a.user_id,
      body: bodyOrVoice(a.body),
      voice:
        a.kind === 'voice' && a.voice_path && a.voice_duration_ms
          ? { path: a.voice_path, durationMs: a.voice_duration_ms }
          : null,
      createdAt: a.created_at,
      reactions: (a.reactions ?? []).map((r) => ({ id: r.id, userId: r.user_id, kind: r.kind })),
    })),
  };
}

/**
 * Answer or edit (CONTRACTS §2, D11, D17, D46): one row per person and question,
 * `client_written_at` = when it was written on this device. Text XOR voice: with `voice` the row
 * becomes a voice answer (`body: null`, the uploaded object and its length; `body` is ignored);
 * without it a text answer that also clears the voice fields (a text-only upsert on a voice row
 * fails the CHECK).
 *
 * D56 / BE-57: a write to a daily question whose day (plus 15 min) has ended raises `DAY_ENDED`.
 * An unchanged re-send of my own stored answer on an ended or locked day succeeds with 0 rows
 * (SEC-13 Info 1): that is why there is no `.select().single()` here; no row back is success.
 */
export async function saveAnswer(input: {
  coupleQuestionId: string;
  userId: string;
  body: string;
  voice?: VoiceRef | null;
  clientWrittenAt: string;
}): Promise<void> {
  const { voice } = input;
  unwrap(
    await supabase.from('answers').upsert(
      {
        couple_question_id: input.coupleQuestionId,
        user_id: input.userId,
        client_written_at: input.clientWrittenAt,
        ...(voice
          ? {
              kind: 'voice' as const,
              body: null,
              voice_path: voice.path,
              voice_duration_ms: Math.max(1, Math.round(voice.durationMs)),
            }
          : { kind: 'text' as const, body: input.body, voice_path: null, voice_duration_ms: null }),
      },
      { onConflict: 'couple_question_id,user_id' },
    ),
  );
}

/** One reaction per person per answer: reacting again replaces the emoji (D45). */
export async function setAnswerReaction(input: {
  answerId: string;
  userId: string;
  kind: ReactionKind;
}): Promise<void> {
  unwrap(
    await supabase
      .from('reactions')
      .upsert(
        { answer_id: input.answerId, user_id: input.userId, kind: input.kind },
        { onConflict: 'answer_id,user_id' },
      ),
  );
}

export async function removeAnswerReaction(input: {
  answerId: string;
  userId: string;
}): Promise<void> {
  unwrap(
    await supabase
      .from('reactions')
      .delete()
      .eq('answer_id', input.answerId)
      .eq('user_id', input.userId),
  );
}

/** `get_streak()` (BE-06). Normalised by the hook (QA-BUG-3 nulls). */
export async function getStreak(): Promise<RawStreak | null> {
  return unwrap(await supabase.rpc('get_streak'));
}

/**
 * `use_streak_saver()` (BE-11, D18): protects yesterday for the couple, once per local month,
 * premium only. Returns the `get_streak` shape. The server decides everything (which day, quota,
 * premium); the app never edits a streak. Errors: NOT_PAIRED, PREMIUM_REQUIRED, SAVER_UNAVAILABLE.
 */
export async function claimStreakSaver(): Promise<RawStreak | null> {
  return unwrap(await supabase.rpc('use_streak_saver'));
}

/** `send_nudge()` (D16, BE-10) is live: the Today screen shows the nudge on 23. */
export const NUDGE_AVAILABLE = true;

/**
 * One nudge per sender per couple-local day while the partner hasn't answered today's daily
 * question. Errors: NOT_PAIRED, PARTNER_ALREADY_ANSWERED, NUDGE_LIMIT (also after a push the
 * partner's settings suppressed: the quota is still used).
 */
export async function sendNudge(options?: MessageOptions): Promise<void> {
  const { error } = await supabase.rpc('send_nudge');
  if (error) throw toAppError(error, options);
}
