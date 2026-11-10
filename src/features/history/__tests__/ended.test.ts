import {
  ENDED_HISTORY_DAYS,
  endedAnswerState,
  endedHistoryUntil,
  endedRowsForMe,
  isEndedHistoryOpen,
  untilLabel,
  type EndedRow,
} from '@/features/history/ended';

const ENDED_AT = '2026-11-01T12:00:00Z';
const paired = { ended_at: ENDED_AT, paired_at: '2026-10-01T10:00:00Z' };

describe('ended couple History window (MOB-50, D08)', () => {
  it('closes 30 days after the couple ended', () => {
    expect(ENDED_HISTORY_DAYS).toBe(30);
    expect(endedHistoryUntil(ENDED_AT)?.toISOString()).toBe('2026-12-01T12:00:00.000Z');
  });

  it('is open until ended_at + 30 days, then closed', () => {
    expect(isEndedHistoryOpen(paired, new Date('2026-11-01T12:00:01Z'))).toBe(true);
    expect(isEndedHistoryOpen(paired, new Date('2026-12-01T11:59:59Z'))).toBe(true);
    expect(isEndedHistoryOpen(paired, new Date('2026-12-01T12:00:00Z'))).toBe(false);
    expect(isEndedHistoryOpen(paired, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('is closed with no couple, no partner (solo archive) or an unknown end time', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    expect(isEndedHistoryOpen(null, now)).toBe(false);
    expect(isEndedHistoryOpen(undefined, now)).toBe(false);
    expect(isEndedHistoryOpen({ ...paired, paired_at: null }, now)).toBe(false);
    expect(isEndedHistoryOpen({ ...paired, ended_at: null }, now)).toBe(false);
    expect(endedHistoryUntil('nope')).toBeNull();
  });

  it('formats the last day', () => {
    expect(untilLabel(new Date('2026-12-01T12:00:00Z'), 'en')).toMatch(/Dec/);
  });
});

describe('ended couple History reveal rule (MOB-50)', () => {
  const row = (id: string, answeredBy: string[]): EndedRow => ({
    id,
    source: 'daily',
    assignedFor: '2026-10-20',
    createdAt: '2026-10-20T00:05:00Z',
    question: `Q ${id}`,
    answeredBy,
    replies: 0,
  });

  it('lists only the questions I answered', () => {
    const rows = [row('both', ['u1', 'u2']), row('mine', ['u1']), row('theirs', ['u2'])];
    expect(endedRowsForMe(rows, 'u1').map((r) => r.id)).toEqual(['both', 'mine']);
    expect(endedRowsForMe(rows, null)).toEqual([]);
  });

  it("shows my partner's answer only when we both answered", () => {
    expect(endedAnswerState(['u1', 'u2'], 'u1')).toEqual({ mine: true, both: true });
    expect(endedAnswerState(['u1'], 'u1')).toEqual({ mine: true, both: false });
    expect(endedAnswerState(['u2'], 'u1')).toEqual({ mine: false, both: false });
    expect(endedAnswerState(['u1', 'u2'], null)).toEqual({ mine: false, both: false });
  });
});
