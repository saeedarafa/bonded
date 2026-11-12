import { useEffect, useRef } from 'react';

import { localDateKey } from '@/features/daily/today';
import { track } from '@/lib/analytics';

import type { HistoryDetail } from './api';

/**
 * History call sites (MOB-24d, ANALYTICS §3.7): counts, ids and whole days only, never the
 * question or an answer.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from one couple-local date (`2026-11-03`) to another, never negative. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/** 29: once per visit, when the first page of days is in. */
export function useHistoryViewed(items: number | null): void {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || items === null) return;
    sent.current = true;
    track('history_viewed', { items });
  }, [items]);
}

/** 30: once per visit, when the day is in (its `questions` id; no id, no event). */
export function useHistoryItemOpened(
  detail: Pick<HistoryDetail, 'questionId' | 'assignedFor' | 'createdAt'> | null | undefined,
  timeZone: string | null | undefined,
): void {
  const sent = useRef(false);
  const questionId = detail?.questionId;
  const day = detail
    ? (detail.assignedFor ?? localDateKey(new Date(detail.createdAt), timeZone))
    : null;
  useEffect(() => {
    if (sent.current || !questionId || !day || timeZone === undefined) return;
    const daysAgo = daysBetween(day, localDateKey(new Date(), timeZone));
    if (daysAgo === null) return;
    sent.current = true;
    track('history_item_opened', { question_id: questionId, days_ago: daysAgo });
  }, [questionId, day, timeZone]);
}
