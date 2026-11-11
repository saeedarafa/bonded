import { bodyOrVoice } from '@/features/voice/placeholder';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';

import type { EndedRow } from './ended';
import type { ExportQuestion } from './exportPdf';
import type { DayRow } from './model';

/**
 * History (MOB-16). None of these selects read answer or message text, except `getLastMessage`,
 * which the hooks call only once my own answer exists (RLS opens the thread only when both have).
 * Every query is scoped to the ACTIVE couple: RLS also returns an ended couple's archive (D08),
 * which has its own screen.
 *
 * MOB-71 (D55, BE-55): the list, the detail and the ended archive come from `history_days`, which
 * tells who answered and whether the day is `locked` (a free couple's day older than yesterday;
 * for the ended archive, a reader without Premium of their own). On a locked day the database
 * returns no answers, messages or reactions at all, so who answered can only come from here.
 */

type HistoryDayRow = Database['public']['Functions']['history_days']['Returns'][number];

/**
 * `history_days` says who answered as booleans, not ids. The screens test `answeredBy` against my
 * id and count it, so the partner gets this stand-in id (never compared with a real user id).
 */
export const PARTNER_ANSWERED = 'partner';

/** Who answered, as ids: my id when I did, `PARTNER_ANSWERED` when my partner did. */
export function answeredByOf(
  row: Pick<HistoryDayRow, 'my_answered' | 'partner_answered'>,
  myId: string | null | undefined,
): string[] {
  const by: string[] = [];
  if (row.my_answered && myId) by.push(myId);
  if (row.partner_answered) by.push(PARTNER_ANSWERED);
  return by;
}

/** The question text from `history_days.question` (the `questions` row as JSON). */
export function questionBodyOf(question: Json): string {
  if (question && typeof question === 'object' && !Array.isArray(question)) {
    const body = question.body;
    if (typeof body === 'string') return body;
  }
  return '';
}

/** A daily question's local date (`day`); null for a pack question (the screens use `createdAt`). */
const assignedForOf = (r: HistoryDayRow) => (r.source === 'daily' ? r.day : null);

async function historyDays(args: Database['public']['Functions']['history_days']['Args']) {
  return unwrap(await supabase.rpc('history_days', args)) ?? [];
}

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
  /** D55: the answers of this day are closed for us (free couple, older than yesterday). */
  locked?: boolean;
  /** D56: whether I answered (with `answerCount`, who answered a day only one of us did). */
  myAnswered?: boolean;
};

export const HISTORY_PAGE_SIZE = 20;

/**
 * CONTRACTS §2 "History page" (BE-55): `history_days` newest first, a page at a time, daily and
 * pack questions, every day (also the ones nobody answered: the screen decides what to list). The
 * hearts come from a second read, only for the days that are open (`locked` days return nothing).
 */
export async function getHistoryPage(coupleId: string, page: number): Promise<HistoryRow[]> {
  const days = await historyDays({
    p_couple_id: coupleId,
    p_limit: HISTORY_PAGE_SIZE,
    p_offset: page * HISTORY_PAGE_SIZE,
  });
  const openIds = days
    .filter((d) => !d.locked && (d.my_answered || d.partner_answered))
    .map((d) => d.couple_question_id);
  const hearts = new Map<string, number>();
  if (openIds.length > 0) {
    const rows = unwrap(
      await supabase
        .from('couple_questions')
        .select('id, answers(reactions(count))')
        .in('id', openIds),
    );
    for (const r of rows ?? []) {
      hearts.set(
        r.id,
        (r.answers ?? []).reduce((n, a) => n + (a.reactions?.[0]?.count ?? 0), 0),
      );
    }
  }
  return days.map((d) => ({
    id: d.couple_question_id,
    source: d.source,
    assignedFor: assignedForOf(d),
    createdAt: d.created_at,
    answerCount: (d.my_answered ? 1 : 0) + (d.partner_answered ? 1 : 0),
    myAnswered: d.my_answered,
    question: questionBodyOf(d.question),
    hearts: hearts.get(d.couple_question_id) ?? 0,
    replies: d.message_count,
    locked: d.locked,
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
  /** My id and/or `PARTNER_ANSWERED` (see `answeredByOf`). */
  answeredBy: string[];
  replies: number;
  /** D55: the day's answers and thread are closed for us (Premium opens them). */
  locked?: boolean;
};

/** One day by id (`history_days({ p_couple_question_id })`, BE-55); null when I can't read it. */
export async function getHistoryDetail(
  coupleQuestionId: string,
  myId?: string | null,
): Promise<HistoryDetail | null> {
  const [row] = await historyDays({ p_couple_question_id: coupleQuestionId });
  if (!row) return null;
  const answeredBy = answeredByOf(row, myId);
  return {
    id: row.couple_question_id,
    source: row.source,
    assignedFor: assignedForOf(row),
    createdAt: row.created_at,
    answerCount: (row.my_answered ? 1 : 0) + (row.partner_answered ? 1 : 0),
    question: questionBodyOf(row.question),
    answeredBy,
    replies: row.message_count,
    locked: row.locked,
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
 * answered and the reply count. MOB-71: from `history_days` (the ended couple's id), so a day
 * that is locked for me (D55: older than yesterday and I have no Premium of my own) still shows,
 * locked. The server returns nothing once the 30 days are over.
 */
export async function getEndedHistoryPage(
  coupleId: string,
  page: number,
  myId?: string | null,
): Promise<EndedRow[]> {
  const days = await historyDays({
    p_couple_id: coupleId,
    p_limit: HISTORY_PAGE_SIZE,
    p_offset: page * HISTORY_PAGE_SIZE,
  });
  return days.map((d) => toEndedRow(d, myId));
}

/** One question of the ended couple (by both ids, so another couple's question never opens here). */
export async function getEndedQuestion(
  coupleId: string,
  coupleQuestionId: string,
  myId?: string | null,
): Promise<EndedRow | null> {
  const [row] = await historyDays({ p_couple_question_id: coupleQuestionId });
  return row && row.couple_id === coupleId ? toEndedRow(row, myId) : null;
}

function toEndedRow(r: HistoryDayRow, myId: string | null | undefined): EndedRow {
  return {
    id: r.couple_question_id,
    source: r.source,
    assignedFor: assignedForOf(r),
    createdAt: r.created_at,
    question: questionBodyOf(r.question),
    answeredBy: answeredByOf(r, myId),
    replies: r.message_count,
    locked: r.locked,
  };
}

const EXPORT_PAGE_SIZE = 100;

/**
 * MOB-27 (D08, 58): everything the History PDF needs from an ended couple. This is the only History
 * read that takes answer and message text in bulk; RLS decides what comes back (my answers, my
 * partner's only where I answered too, the thread only where we both did) and `exportEntries`
 * applies the same rule again. Never log the result.
 *
 * MOB-71 (D55): `history_days` first (100 a time), then the text of the OPEN days only. A day I
 * answered that is locked for me comes back as `locked: true` with no answers, so the PDF can say
 * how many days need Premium; nothing of it is read.
 */
export async function getHistoryExport(coupleId: string): Promise<ExportQuestion[]> {
  const days: HistoryDayRow[] = [];
  for (let page = 0; ; page += 1) {
    const rows = await historyDays({
      p_couple_id: coupleId,
      p_limit: EXPORT_PAGE_SIZE,
      p_offset: page * EXPORT_PAGE_SIZE,
    });
    days.push(...rows);
    if (rows.length < EXPORT_PAGE_SIZE) break;
  }
  const all: ExportQuestion[] = days
    .filter((d) => d.locked && d.my_answered)
    .map((d) => ({
      id: d.couple_question_id,
      source: d.source,
      assignedFor: assignedForOf(d),
      createdAt: d.created_at,
      question: questionBodyOf(d.question),
      answers: [],
      messages: [],
      locked: true,
    }));
  const openIds = days.filter((d) => !d.locked && d.my_answered).map((d) => d.couple_question_id);
  for (let i = 0; i < openIds.length; i += EXPORT_PAGE_SIZE) {
    const rows = unwrap(
      await supabase
        .from('couple_questions')
        .select(
          'id, source, assigned_for, created_at, question:questions(body), answers(user_id, body, created_at), thread_messages(user_id, body, created_at)',
        )
        .eq('couple_id', coupleId)
        .in('id', openIds.slice(i, i + EXPORT_PAGE_SIZE)),
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
  }
  return all;
}
