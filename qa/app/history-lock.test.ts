// QA-39 (D55, MOB-71 / MOB-27): History is Premium beyond yesterday, one layer below the screens.
// The real Supabase client and the real `src/features/history/api.ts` run against a fake PostgREST
// (the fetch seam): `history_days` says which days are `locked`, and the test records every request
// the app makes after that. The release question here is "does the app ever ASK for a locked day's
// text?" (the database refuses it anyway, qa/contract/premium-history.test.ts; this is the app half):
// - the History PDF (MOB-27) reads answer and message text only for open days, counts the locked
//   days I answered, and the HTML handed to expo-print has no locked day in it;
// - the History list (29) reads reactions only for open days and passes `locked` through;
// - the detail (30) and the ended archive keep `locked` from the server.
// Fixture text is FIXTURE-…; each locked day's question carries LOCKED so a leak shows by name.
import { getEndedHistoryPage, getHistoryDetail, getHistoryExport, getHistoryPage } from '@/features/history/api';
import { exportEntries, historyHtml, lockedExportDays } from '@/features/history/exportPdf';
import { colors } from '@/ui/theme';

import personas from '../fixtures/personas.json';

const MAYA = personas.personas.maya.id;
const SAM = personas.personas.sam.id;
const COUPLE = 'fixture-couple-maya-sam';

type Day = {
  couple_question_id: string;
  couple_id: string;
  question_id: string;
  question: { body: string };
  source: 'daily' | 'pack';
  day: string;
  created_at: string;
  my_answered: boolean;
  partner_answered: boolean;
  message_count: number;
  locked: boolean;
};

/** Couple-local days: today 2026-11-10 (free couple, so -2 and older are locked). */
const day = (id: string, date: string, o: Partial<Day> = {}): Day => ({
  couple_question_id: id,
  couple_id: COUPLE,
  question_id: `q-${id}`,
  question: { body: `FIXTURE-QUESTION ${id}${o.locked ? ' LOCKED' : ''}` },
  source: 'daily',
  day: date,
  created_at: `${date}T08:00:00Z`,
  my_answered: true,
  partner_answered: true,
  message_count: 2,
  locked: false,
  ...o,
});

const DAYS: Day[] = [
  day('cq-d0', '2026-11-10'),
  day('cq-d1', '2026-11-09'),
  day('cq-d2', '2026-11-08', { locked: true }),
  day('cq-d5', '2026-11-05', { locked: true, partner_answered: false }),
  // Locked and I never answered: not in the PDF at all, not even counted (D09: my own answers).
  day('cq-d6', '2026-11-04', { locked: true, my_answered: false, message_count: 0 }),
  // Open, nobody answered (a missed day): listed by history_days, no text read.
  day('cq-d3', '2026-11-07', { my_answered: false, partner_answered: false, message_count: 0, locked: true }),
];
const OPEN_ANSWERED = ['cq-d0', 'cq-d1'];
const LOCKED_IDS = DAYS.filter((d) => d.locked).map((d) => d.couple_question_id);

type Req = { method: string; path: string; params: URLSearchParams; body: unknown };
const requests: Req[] = [];
let historyRows: Day[] = DAYS;

/** `id=in.(a,b)` as the list of ids, or null when the request has no id filter. */
const idsOf = (r: Req | undefined) => {
  const v = r?.params.get('id');
  return v?.startsWith('in.(') ? v.slice(4, -1).split(',').map((s) => s.replace(/"/g, '')) : null;
};

/** What PostgREST returns for the text select on open days (RLS has already done its part). */
function textRows(ids: string[]) {
  return DAYS.filter((d) => ids.includes(d.couple_question_id)).map((d) => ({
    id: d.couple_question_id,
    source: d.source,
    assigned_for: d.day,
    created_at: d.created_at,
    question: { body: d.question.body },
    answers: [
      { user_id: MAYA, body: `FIXTURE-ANSWER-MAYA ${d.couple_question_id}`, created_at: d.created_at },
      { user_id: SAM, body: `FIXTURE-ANSWER-SAM ${d.couple_question_id}`, created_at: d.created_at },
    ],
    thread_messages: [{ user_id: SAM, body: `FIXTURE-MSG ${d.couple_question_id}`, created_at: d.created_at }],
  }));
}

async function fakePostgrest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  const req = { method, path: url.pathname, params: url.searchParams, body };
  requests.push(req);
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/rest/v1/rpc/history_days') {
    const a = body as { p_limit?: number; p_offset?: number; p_couple_question_id?: string };
    if (a.p_couple_question_id) return json(historyRows.filter((d) => d.couple_question_id === a.p_couple_question_id));
    const off = a.p_offset ?? 0;
    return json(historyRows.slice(off, off + (a.p_limit ?? 20)));
  }
  if (url.pathname === '/rest/v1/couple_questions') {
    const ids = idsOf(req) ?? [];
    const select = url.searchParams.get('select') ?? '';
    if (select.includes('reactions(count)')) {
      return json(ids.map((id) => ({ id, answers: [{ reactions: [{ count: 1 }] }, { reactions: [{ count: 2 }] }] })));
    }
    return json(textRows(ids));
  }
  return new Response('{}', { status: 404 });
}

beforeEach(() => {
  requests.length = 0;
  historyRows = DAYS;
  (globalThis as unknown as { __qaFetch?: unknown }).__qaFetch = fakePostgrest;
});
afterAll(() => {
  (globalThis as unknown as { __qaFetch?: unknown }).__qaFetch = undefined;
});

const textReads = () => requests.filter((r) => r.path === '/rest/v1/couple_questions');

describe('PDF export (MOB-27) only reads and prints the days I can open (D55)', () => {
  it('asks history_days first, then text only for the open days I answered', async () => {
    await getHistoryExport(COUPLE);
    expect(requests[0]?.path).toBe('/rest/v1/rpc/history_days');
    const reads = textReads();
    expect(reads).toHaveLength(1);
    expect(reads[0]?.params.get('select')).toMatch(/answers\(.*body/);
    expect(idsOf(reads[0])?.sort()).toEqual([...OPEN_ANSWERED].sort());
    for (const id of LOCKED_IDS) expect(idsOf(reads[0])).not.toContain(id);
  });

  it('a locked day I answered comes back as locked with no text; one I did not answer is left out', async () => {
    const rows = await getHistoryExport(COUPLE);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(Object.keys(by).sort()).toEqual(['cq-d0', 'cq-d1', 'cq-d2', 'cq-d5']);
    for (const id of ['cq-d2', 'cq-d5']) {
      expect(by[id]?.locked).toBe(true);
      expect(by[id]?.answers).toEqual([]);
      expect(by[id]?.messages).toEqual([]);
    }
    expect(by['cq-d0']?.answers).toHaveLength(2);
    expect(lockedExportDays(rows)).toBe(2);
  });

  it('the PDF HTML holds the open days only, and says how many need Premium', async () => {
    const rows = await getHistoryExport(COUPLE);
    const entries = exportEntries(rows, MAYA);
    expect(entries.map((e) => e.id)).toEqual(['cq-d1', 'cq-d0']);
    const html = historyHtml(
      entries,
      {
        lang: 'en',
        title: 'FIXTURE-TITLE',
        subtitle: 'FIXTURE-SUBTITLE',
        you: 'You',
        partner: 'Sam',
        onlyYou: 'Only you answered',
        replies: 'Replies',
        empty: 'FIXTURE-EMPTY',
        footer: 'FIXTURE-FOOTER',
        lockedNote: `FIXTURE-LOCKED-NOTE ${lockedExportDays(rows)}`,
      },
      colors.light,
      'en',
    );
    expect(html).toContain('FIXTURE-ANSWER-SAM cq-d1');
    expect(html).toContain('FIXTURE-LOCKED-NOTE 2');
    expect(html).not.toContain(' LOCKED');
    for (const id of LOCKED_IDS) expect(html).not.toContain(id);
  });

  it('a Premium reader (nothing locked) exports every day they answered', async () => {
    historyRows = DAYS.map((d) => ({ ...d, locked: false }));
    const rows = await getHistoryExport(COUPLE);
    expect(rows.every((r) => !r.locked)).toBe(true);
    expect(idsOf(textReads()[0])?.sort()).toEqual(['cq-d0', 'cq-d1', 'cq-d2', 'cq-d5']);
    expect(lockedExportDays(rows)).toBe(0);
  });

  it('pages history_days 100 at a time until a short page', async () => {
    historyRows = Array.from({ length: 150 }, (_, i) =>
      day(`cq-p${i}`, '2026-10-01', { locked: i >= 2 }),
    );
    const rows = await getHistoryExport(COUPLE);
    const pages = requests.filter((r) => r.path === '/rest/v1/rpc/history_days');
    expect(pages.map((r) => (r.body as { p_offset: number }).p_offset)).toEqual([0, 100]);
    expect(idsOf(textReads()[0])?.sort()).toEqual(['cq-p0', 'cq-p1']);
    expect(lockedExportDays(rows)).toBe(148);
  });
});

describe('History list, detail and ended archive keep the server\'s lock (D55)', () => {
  it('29: reactions are read only for open answered days; locked days stay listed with their question', async () => {
    const rows = await getHistoryPage(COUPLE, 0);
    const hearts = textReads();
    expect(hearts).toHaveLength(1);
    expect(hearts[0]?.params.get('select')).not.toMatch(/body/);
    expect(idsOf(hearts[0])?.sort()).toEqual(['cq-d0', 'cq-d1']);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(DAYS.length);
    expect(by['cq-d2']).toMatchObject({ locked: true, hearts: 0, answerCount: 2, question: 'FIXTURE-QUESTION cq-d2 LOCKED' });
    expect(by['cq-d1']).toMatchObject({ locked: false, hearts: 3 });
  });

  it('29: a page with only locked days reads no reactions at all', async () => {
    historyRows = DAYS.filter((d) => d.locked);
    await getHistoryPage(COUPLE, 0);
    expect(textReads()).toEqual([]);
  });

  it('30: the detail of a locked day says locked and who answered, and reads nothing else', async () => {
    const d = await getHistoryDetail('cq-d2', MAYA);
    expect(d).toMatchObject({ id: 'cq-d2', locked: true, answerCount: 2 });
    expect(requests.map((r) => r.path)).toEqual(['/rest/v1/rpc/history_days']);
  });

  it('ended archive: a day locked for this reader stays listed, locked', async () => {
    const rows = await getEndedHistoryPage(COUPLE, 0, MAYA);
    expect(rows.find((r) => r.id === 'cq-d2')?.locked).toBe(true);
    expect(rows.find((r) => r.id === 'cq-d1')?.locked).toBe(false);
    expect(textReads()).toEqual([]);
  });
});
