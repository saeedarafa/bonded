import { localDateKey } from '@/features/daily/today';
import { personColors, type ThemeColors } from '@/ui/theme';

/**
 * MOB-27 (D08, 58): the History PDF ("A PDF of your answers and replies"), built on the phone.
 * Pure, so the reveal rule and the escaping are unit tested on their own:
 * - a question is in the PDF only when I answered it (D09: I keep my own answers);
 * - my partner's answer and the replies only when we both answered (the reveal rule; RLS already
 *   hides them otherwise, this is the second guard, so a stray row can never reach the file);
 * - every piece of user or content text is HTML-escaped (an answer like `<img src=x>` prints as
 *   text, it never becomes markup in the print web view).
 * Nothing here logs: the strings only go into the HTML handed to expo-print.
 */

export type ExportText = { userId: string; body: string; createdAt: string };

/** One question as read for the export (answers and messages as RLS returns them). */
export type ExportQuestion = {
  id: string;
  source: string;
  assignedFor: string | null;
  createdAt: string;
  question: string;
  answers: ExportText[];
  messages: ExportText[];
  /** D55 (MOB-71): a day I answered that is closed for me: never in the PDF, only counted. */
  locked?: boolean;
};

export type ExportEntry = {
  id: string;
  /** `YYYY-MM-DD`: the daily question's date, or the day a pack question was started. */
  dateKey: string;
  question: string;
  mine: string;
  /** Null when my partner did not answer (or their answers were deleted with their account, D09). */
  partner: string | null;
  replies: { mine: boolean; body: string }[];
};

const byTime = (a: { createdAt: string }, b: { createdAt: string }) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

/** The questions that go in the PDF, oldest first, with the reveal rule applied. */
export function exportEntries(
  rows: readonly ExportQuestion[],
  myId: string | null,
  timeZone?: string | null,
): ExportEntry[] {
  if (!myId) return [];
  const entries: (ExportEntry & { createdAt: string })[] = [];
  for (const row of rows) {
    if (row.locked) continue;
    const mine = row.answers.find((a) => a.userId === myId);
    if (!mine) continue;
    const theirs = row.answers.find((a) => a.userId !== myId) ?? null;
    const both = theirs !== null;
    entries.push({
      id: row.id,
      createdAt: row.createdAt,
      dateKey: row.assignedFor ?? localDateKey(new Date(row.createdAt), timeZone),
      question: row.question,
      mine: mine.body,
      partner: both ? theirs.body : null,
      replies: both
        ? [...row.messages].sort(byTime).map((m) => ({ mine: m.userId === myId, body: m.body }))
        : [],
    });
  }
  return entries
    .sort((a, b) => (a.dateKey === b.dateKey ? byTime(a, b) : a.dateKey < b.dateKey ? -1 : 1))
    .map(({ createdAt: _createdAt, ...entry }) => entry);
}

/** D55 (MOB-71): how many days I answered are left out because they need Premium. */
export function lockedExportDays(rows: readonly ExportQuestion[]): number {
  return rows.filter((r) => r.locked).length;
}

/** Text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** All fixed copy, already translated (partner names inside it are escaped here too). */
export type ExportCopy = {
  lang: string;
  title: string;
  subtitle: string;
  you: string;
  partner: string;
  onlyYou: string;
  replies: string;
  empty: string;
  footer: string;
  /** D55 (MOB-71): "3 older days need Premium and aren't in this PDF." Omitted when none. */
  lockedNote?: string;
};

/** "Mar 4, 2026" for a `YYYY-MM-DD` key, in the phone's language. */
export function exportDate(dateKey: string, locale = 'en'): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** The whole document. Light palette tokens only; system fonts (print has no Outfit/DM Sans). */
export function historyHtml(
  entries: readonly ExportEntry[],
  copy: ExportCopy,
  c: ThemeColors,
  locale = 'en',
): string {
  const me = personColors(c, true);
  const them = personColors(c, false);
  const e = escapeHtml;
  const answer = (who: string, body: string, color: string, tint: string) =>
    `<div class="answer" style="background:${tint}"><div class="who" style="color:${color}">${e(
      who,
    )}</div><div class="text">${e(body)}</div></div>`;

  const items = entries
    .map((entry) => {
      const replies = entry.replies.length
        ? `<div class="replies"><div class="label">${e(copy.replies)}</div>${entry.replies
            .map(
              (r) =>
                `<div class="reply"><span class="who" style="color:${
                  r.mine ? me.text : them.text
                }">${e(r.mine ? copy.you : copy.partner)}</span> <span class="text">${e(
                  r.body,
                )}</span></div>`,
            )
            .join('')}</div>`
        : '';
      return `<section class="q"><div class="date">${e(exportDate(entry.dateKey, locale))}</div><h2>${e(
        entry.question,
      )}</h2>${answer(copy.you, entry.mine, me.text, me.tint)}${
        entry.partner === null
          ? `<p class="note">${e(copy.onlyYou)}</p>`
          : answer(copy.partner, entry.partner, them.text, them.tint)
      }${replies}</section>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="${e(copy.lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(
    copy.title,
  )}</title><style>
body{margin:0;padding:32px;font-family:-apple-system,system-ui,Roboto,sans-serif;color:${c.text};background:${c.surface}}
h1{margin:0 0 4px;font-size:26px}
.sub{margin:0 0 24px;color:${c.text2};font-size:14px}
.q{padding:16px 0;border-top:1px solid ${c.line};break-inside:avoid;page-break-inside:avoid}
.date{color:${c.text3};font-size:12px;font-variant-numeric:tabular-nums}
h2{margin:4px 0 12px;font-size:18px;line-height:1.3}
.answer{border-radius:12px;padding:10px 14px;margin:0 0 8px}
.who{font-weight:600;font-size:12px}
.text{white-space:pre-wrap;word-wrap:break-word;font-size:15px;line-height:1.45}
.note{margin:0 0 8px;color:${c.text3};font-size:13px}
.replies{margin-top:8px}
.label{color:${c.text2};font-size:12px;font-weight:600;margin-bottom:4px}
.reply{font-size:14px;line-height:1.45;margin:2px 0;white-space:pre-wrap;word-wrap:break-word}
.reply .text{font-size:14px}
.foot{margin-top:24px;color:${c.text3};font-size:12px;text-align:center}
</style></head><body><h1>${e(copy.title)}</h1><p class="sub">${e(copy.subtitle)}</p>${
    copy.lockedNote ? `<p class="note locked">${e(copy.lockedNote)}</p>` : ''
  }${
    items || `<p class="note">${e(copy.empty)}</p>`
  }<p class="foot">${e(copy.footer)}</p></body></html>`;
}
