import { bodyOrVoice } from '@/features/voice/placeholder';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import type { EndedRow } from './ended';
import type { ExportQuestion } from './exportPdf';
import type { DayRow } from './model';

/**
 * History (MOB-16). None of these selects read answer or message text, except `getLastMessage`,
 * which the hooks call only once my own answer exists (RLS opens the thread only when both have).
 * Every query is scoped to the ACTIVE couple: RLS also returns an ended couple's archive (D08),
 * which has its own screen.
 */

/** The month's daily questions (board 29 heatmap): date and how many answered. */
export async function getHistoryMonth(
  coupleId: string,
  start: string,
  end: string,
): Promise<DayRow[]> {
  const rows = unwrap(
    await supabase
      .from('couple_questions')
      .select('assigned_for, answer_count')
      .eq('couple_id', coupleId)
      .eq('source', 'daily')
      .gte('assigned_for', start)
      .lte('assigned_for', end),
  );
  return (rows ?? []).flatMap((r) =>
    r.assigned_for ? [{ assignedFor: r.assigned_for, answerCount: r.answer_count }] : [],
  );
}

/** The first daily question's date: the heatmap is empty before it. Null when there is none. */
export async function getFirstHistoryDay(coupleId: string): Promise<string | null> {
  const row = unwrap(
    await supabase
      .from('couple_questions')
      .select('assigned_for')
      .eq('couple_id', coupleId)
      .eq('source', 'daily')
      .not('assigned_for', 'is', null)
      .order('assigned_for', { ascending: true })
      .limit(1)
      .maybeSingle(),
  );
  return row?.assigned_for ?? null;
}

/** One list row (board 29): no answer text, only counts. */
export type HistoryRow = {
  id: string;
  source: string;
  /** Local date of a daily question; null for pack questions (they use `createdAt`). */
  assignedFor: string | null;
  createdAt: string;
  answerCount: number;
  question: string;
  /** Reactions on the answers I can see (a locked partner answer and its reactions are absent). */
  hearts: number;
  replies: number;
};

export const HISTORY_PAGE_SIZE = 20;

/**
 * CONTRACTS §2 "History page": newest first, a page at a time; daily and pack questions. Only
 * questions someone answered (a missed day shows on the heatmap, not here).
 */
export async function getHistoryPage(coupleId: string, page: number): Promise<HistoryRow[]> {
  const from = page * HISTORY_PAGE_SIZE;
  const rows = unwrap(
    await supabase
      .from('couple_questions')
      .select(
        'id, source, assigned_for, created_at, answer_count, question:questions(body), answers(user_id, reactions(count)), thread_messages(count)',
      )
      .eq('couple_id', coupleId)
      .gt('answer_count', 0)
      .order('created_at', { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE - 1),
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    source: r.source,
    assignedFor: r.assigned_for,
    createdAt: r.created_at,
    answerCount: r.answer_count,
    question: r.question?.body ?? '',
    hearts: (r.answers ?? []).reduce((n, a) => n + (a.reactions?.[0]?.count ?? 0), 0),
    replies: r.thread_messages?.[0]?.count ?? 0,
  }));
}

/** Board 30 without text: who answered (ids), the question, and the reply count. */
export type HistoryDetail = {
  id: string;
  source: string;
  assignedFor: string | null;
  createdAt: string;
  answerCount: number;
  question: string;
  answeredBy: string[];
  replies: number;
};

export async function getHistoryDetail(coupleQuestionId: string): Promise<HistoryDetail | null> {
  const row = unwrap(
    await supabase
      .from('couple_questions')
      .select(
        'id, source, assigned_for, created_at, answer_count, question:questions(body), answers(user_id), thread_messages(count)',
      )
      .eq('id', coupleQuestionId)
      .maybeSingle(),
  );
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    assignedFor: row.assigned_for,
    createdAt: row.created_at,
    answerCount: row.answer_count,
    question: row.question?.body ?? '',
    answeredBy: (row.answers ?? []).map((a) => a.user_id),
    replies: row.thread_messages?.[0]?.count ?? 0,
  };
}

/** Board 30 thread preview: the newest message ("Sam: Still thinking…"). Only after I answered. */
export type LastMessage = { userId: string; body: string };

export async function getLastMessage(coupleQuestionId: string): Promise<LastMessage | null> {
  const row = unwrap(
    await supabase
      .from('thread_messages')
      .select('user_id, body')
      .eq('couple_question_id', coupleQuestionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row ? { userId: row.user_id, body: bodyOrVoice(row.body) } : null;
}

/**
 * MOB-50 (D08): one page of my ended couple's archive, newest first. No answer text: only who
 * answered (RLS shows my partner's row only where I answered too) and the reply count. RLS returns
 * nothing once the 30 days are over.
 */
export async function getEndedHistoryPage(coupleId: string, page: number): Promise<EndedRow[]> {
  const from = page * HISTORY_PAGE_SIZE;
  const rows = unwrap(
    await supabase
      .from('couple_questions')
      .select(
        'id, source, assigned_for, created_at, question:questions(body), answers(user_id), thread_messages(count)',
      )
      .eq('couple_id', coupleId)
      .gt('answer_count', 0)
      .order('created_at', { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE - 1),
  );
  return (rows ?? []).map(toEndedRow);
}

/** One question of the ended couple (by both ids, so another couple's question never opens here). */
export async function getEndedQuestion(
  coupleId: string,
  coupleQuestionId: string,
): Promise<EndedRow | null> {
  const row = unwrap(
    await supabase
      .from('couple_questions')
      .select(
        'id, source, assigned_for, created_at, question:questions(body), answers(user_id), thread_messages(count)',
      )
      .eq('couple_id', coupleId)
      .eq('id', coupleQuestionId)
      .maybeSingle(),
  );
  return row ? toEndedRow(row) : null;
}

function toEndedRow(r: {
  id: string;
  source: string;
  assigned_for: string | null;
  created_at: string;
  question: { body: string } | null;
  answers: { user_id: string }[] | null;
  thread_messages: { count: number }[] | null;
}): EndedRow {
  return {
    id: r.id,
    source: r.source,
    assignedFor: r.assigned_for,
    createdAt: r.created_at,
    question: r.question?.body ?? '',
    answeredBy: (r.answers ?? []).map((a) => a.user_id),
    replies: r.thread_messages?.[0]?.count ?? 0,
  };
}

const EXPORT_PAGE_SIZE = 100;

/**
 * MOB-27 (D08, 58): everything the History PDF needs from an ended couple, read 100 questions at
 * a time. This is the only History read that takes answer and message text in bulk; RLS decides
 * what comes back (my answers, my partner's only where I answered too, the thread only where we
 * both did) and `exportEntries` applies the same rule again. Never log the result.
 */
export async function getHistoryExport(coupleId: string): Promise<ExportQuestion[]> {
  const all: ExportQuestion[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * EXPORT_PAGE_SIZE;
    const rows = unwrap(
      await supabase
        .from('couple_questions')
        .select(
          'id, source, assigned_for, created_at, question:questions(body), answers(user_id, body, created_at), thread_messages(user_id, body, created_at)',
        )
        .eq('couple_id', coupleId)
        .gt('answer_count', 0)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + EXPORT_PAGE_SIZE - 1),
    );
    for (const r of rows ?? []) {
      all.push({
        id: r.id,
        source: r.source,
        assignedFor: r.assigned_for,
        createdAt: r.created_at,
        question: r.question?.body ?? '',
        answers: (r.answers ?? []).map((a) => ({
          userId: a.user_id,
          body: bodyOrVoice(a.body),
          createdAt: a.created_at,
        })),
        messages: (r.thread_messages ?? []).map((m) => ({
          userId: m.user_id,
          body: bodyOrVoice(m.body),
          createdAt: m.created_at,
        })),
      });
    }
    if ((rows ?? []).length < EXPORT_PAGE_SIZE) return all;
  }
}
