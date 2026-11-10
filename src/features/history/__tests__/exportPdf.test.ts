import {
  escapeHtml,
  exportDate,
  exportEntries,
  historyHtml,
  type ExportCopy,
  type ExportQuestion,
} from '@/features/history/exportPdf';
import { colors } from '@/ui/theme';

const ME = 'u1';
const SAM = 'u2';

const q = (over: Partial<ExportQuestion> & { id: string }): ExportQuestion => ({
  source: 'daily',
  assignedFor: '2026-10-20',
  createdAt: '2026-10-20T08:00:00Z',
  question: 'What made you smile?',
  answers: [],
  messages: [],
  ...over,
});
const a = (userId: string, body: string, createdAt = '2026-10-20T09:00:00Z') => ({
  userId,
  body,
  createdAt,
});

const COPY: ExportCopy = {
  lang: 'en',
  title: 'Our History: you and Sam',
  subtitle: '2 questions you answered, from Bonded.',
  you: 'You',
  partner: 'Sam',
  onlyYou: 'Only your answer is saved for this one.',
  replies: 'Replies',
  empty: 'There are no answers to save yet.',
  footer: 'Made with Bonded.',
};

describe('exportEntries: the reveal rule (MOB-27)', () => {
  const both = q({
    id: 'both',
    answers: [a(SAM, 'FIXTURE-sam-both'), a(ME, 'FIXTURE-me-both')],
    messages: [
      a(SAM, 'FIXTURE-reply-2', '2026-10-20T10:02:00Z'),
      a(ME, 'FIXTURE-reply-1', '2026-10-20T10:01:00Z'),
    ],
  });
  const onlyMe = q({
    id: 'only-me',
    assignedFor: '2026-10-21',
    answers: [a(ME, 'FIXTURE-me-alone')],
    // A thread row RLS would never return here: still kept out.
    messages: [a(ME, 'FIXTURE-stray-reply')],
  });
  const onlySam = q({
    id: 'only-sam',
    assignedFor: '2026-10-22',
    answers: [a(SAM, 'FIXTURE-sam-unrevealed')],
    messages: [a(SAM, 'FIXTURE-sam-stray-reply')],
  });

  it('keeps my answer, my partner’s and the replies only when we both answered', () => {
    const entries = exportEntries([onlySam, onlyMe, both], ME);
    expect(entries.map((e) => e.id)).toEqual(['both', 'only-me']);
    expect(entries[0]).toEqual({
      id: 'both',
      dateKey: '2026-10-20',
      question: 'What made you smile?',
      mine: 'FIXTURE-me-both',
      partner: 'FIXTURE-sam-both',
      replies: [
        { mine: true, body: 'FIXTURE-reply-1' },
        { mine: false, body: 'FIXTURE-reply-2' },
      ],
    });
    expect(entries[1]).toMatchObject({ mine: 'FIXTURE-me-alone', partner: null, replies: [] });
  });

  it('never puts an unrevealed partner answer (or its thread) in the HTML', () => {
    const html = historyHtml(exportEntries([onlySam, onlyMe, both], ME), COPY, colors.light);
    expect(html).toContain('FIXTURE-me-alone');
    expect(html).toContain('FIXTURE-sam-both');
    expect(html).not.toContain('FIXTURE-sam-unrevealed');
    expect(html).not.toContain('FIXTURE-sam-stray-reply');
    expect(html).not.toContain('FIXTURE-stray-reply');
    expect(html).toContain('Only your answer is saved for this one.');
  });

  it('after my partner deleted their account (D09) only my own answers remain', () => {
    const afterDelete = q({ id: 'gone', answers: [a(ME, 'FIXTURE-mine-kept')] });
    const entries = exportEntries([afterDelete], ME);
    expect(entries).toEqual([
      expect.objectContaining({ mine: 'FIXTURE-mine-kept', partner: null, replies: [] }),
    ]);
  });

  it('is empty without a signed-in user', () => {
    expect(exportEntries([both], null)).toEqual([]);
  });

  it('orders oldest first; a pack question uses the day it was started', () => {
    const pack = q({
      id: 'pack',
      source: 'pack',
      assignedFor: null,
      createdAt: '2026-10-19T12:00:00Z',
      answers: [a(ME, 'x')],
    });
    const entries = exportEntries([onlyMe, both, pack], ME, 'UTC');
    expect(entries.map((e) => [e.id, e.dateKey])).toEqual([
      ['pack', '2026-10-19'],
      ['both', '2026-10-20'],
      ['only-me', '2026-10-21'],
    ]);
  });
});

describe('historyHtml: escaping user text (MOB-27)', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });

  it('prints markup in answers, replies, questions and names as text', () => {
    const evil = '<img src=x onerror="alert(1)"><script>steal()</script>';
    const entries = exportEntries(
      [
        q({
          id: 'x',
          question: `Q ${evil}`,
          answers: [a(ME, `me ${evil}`), a(SAM, `sam ${evil}`)],
          messages: [a(SAM, `reply ${evil}`)],
        }),
      ],
      ME,
    );
    const html = historyHtml(
      entries,
      { ...COPY, partner: `Sam${evil}`, title: `Our History: you and Sam${evil}` },
      colors.light,
    );
    expect(html).not.toMatch(/<img|<script|onerror="/);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html.match(/&lt;script&gt;/g)).toHaveLength(8); // title twice, question, 3 bodies, 2 name labels
    // Nothing loads from anywhere: the CSP blocks every source but inline styles.
    expect(html).toContain(`default-src 'none'; style-src 'unsafe-inline'`);
  });

  it('keeps line breaks of a long answer (pre-wrap), not as markup', () => {
    const html = historyHtml(
      exportEntries([q({ id: 'nl', answers: [a(ME, 'line 1\nline 2')] })], ME),
      COPY,
      colors.light,
    );
    expect(html).toContain('line 1\nline 2');
    expect(html).toContain('white-space:pre-wrap');
  });

  it('labels me and my partner in their own colours (orange me, sky partner)', () => {
    const html = historyHtml(
      exportEntries([q({ id: 'b', answers: [a(ME, 'm'), a(SAM, 's')] })], ME),
      COPY,
      colors.light,
    );
    expect(html).toContain(`color:${colors.light.youText}">You<`);
    expect(html).toContain(`color:${colors.light.partnerText}">Sam<`);
  });

  it('says so when there is nothing to save', () => {
    const html = historyHtml([], COPY, colors.light);
    expect(html).toContain('There are no answers to save yet.');
    expect(html).toContain('<html lang="en">');
  });

  it('dates carry the year (a keepsake spans years)', () => {
    expect(exportDate('2026-03-04')).toBe('Mar 4, 2026');
  });
});
