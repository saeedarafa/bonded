// Content loader (BE-05, D33): turns supabase/content/*.csv into idempotent SQL.
// Owner: backend. The CSVs belong to the product owner; this only reads them.
//
//   import { contentSql } from './content-sql.mjs';
//   contentSql({ includeAgeGated: false })   // string of INSERT ... ON CONFLICT DO UPDATE statements
//
// Natural keys: question_packs.slug, questions.external_id, pack_questions (pack_id, question_id).
// Running the SQL twice changes nothing. Packs with age_gate = '18+' (and their questions) are
// skipped unless includeAgeGated is true (CONTENT_INCLUDE_AGE_GATED=true in the CLI); if they were
// loaded earlier they are set inactive, so turning the flag off again takes them out of the app.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const contentDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');

const STAGES = ['dating', 'living_together', 'engaged_married', 'long_distance'];
const SPECIALS = ['first_day', 'anniversary', 'together_since', 'half_iversary', 'birthday'];

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  text = text.replace(/^\uFEFF/, '');
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; i++;
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; continue;
    }
    field += c; i++;
  }
  if (quoted) throw new Error('csv: unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body.map((r, n) => {
    if (r.length !== header.length) throw new Error(`csv: row ${n + 2} has ${r.length} fields, header has ${header.length}`);
    return Object.fromEntries(header.map((h, k) => [h.trim(), r[k]]));
  });
}

const q = s => {
  if (s.includes('\0')) throw new Error('content contains a NUL byte');
  return `'${s.replace(/'/g, "''")}'`;
};
const qn = s => (s === '' || s == null ? 'null' : q(s));
const bool = (s, what) => {
  if (s !== 'true' && s !== 'false') throw new Error(`${what}: expected true or false, got "${s}"`);
  return s;
};
const int = (s, what, min, max) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what}: expected an integer ${min}–${max}, got "${s}"`);
  return n;
};

/** Reads and validates the content; returns the rows the SQL is built from. */
export function readContent({ includeAgeGated = false, dir = contentDir } = {}) {
  const packsAll = parseCsv(fs.readFileSync(path.join(dir, 'packs.csv'), 'utf8'));
  const questionsAll = parseCsv(fs.readFileSync(path.join(dir, 'questions.csv'), 'utf8'));

  const slugs = new Set();
  for (const p of packsAll) {
    if (!/^[a-z0-9-]+$/.test(p.slug)) throw new Error(`packs.csv: bad slug "${p.slug}"`);
    if (slugs.has(p.slug)) throw new Error(`packs.csv: duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
    if (p.age_gate !== '' && p.age_gate !== '18+') throw new Error(`packs.csv ${p.slug}: age_gate must be empty or 18+`);
    bool(p.is_premium, `packs.csv ${p.slug} is_premium`);
    int(p.sort_order, `packs.csv ${p.slug} sort_order`, 0, 10000);
  }
  const gated = new Set(packsAll.filter(p => p.age_gate === '18+').map(p => p.slug));
  const keep = p => includeAgeGated || p.age_gate !== '18+';

  const ids = new Set();
  const questions = [];
  questionsAll.forEach((r, n) => {
    const where = `questions.csv ${r.external_id || `row ${n + 2}`}`;
    if (!/^[A-Za-z0-9_-]+$/.test(r.external_id)) throw new Error(`${where}: bad external_id`);
    if (ids.has(r.external_id)) throw new Error(`${where}: duplicate external_id`);
    ids.add(r.external_id);
    if (!r.body.trim()) throw new Error(`${where}: empty body`);
    int(r.depth, `${where} depth`, 1, 3);
    bool(r.is_premium, `${where} is_premium`); bool(r.daily_eligible, `${where} daily_eligible`);
    const stages = r.stages === 'all' || r.stages === '' ? [] : r.stages.split('|');
    for (const s of stages) if (!STAGES.includes(s)) throw new Error(`${where}: unknown stage "${s}"`);
    if (r.special !== '' && !SPECIALS.includes(r.special)) throw new Error(`${where}: unknown special "${r.special}"`);
    if (r.special !== '' && r.daily_eligible !== 'false') throw new Error(`${where}: a special question is not daily_eligible`);
    if (r.pack_slug !== '' && !slugs.has(r.pack_slug)) throw new Error(`${where}: unknown pack "${r.pack_slug}"`);
    if (r.pack_slug !== '') int(r.pack_position, `${where} pack_position`, 1, 1000);
    questions.push({ ...r, stages, sort_order: n + 1, age_gate: gated.has(r.pack_slug) ? '18+' : '' });
  });

  return {
    packs: packsAll.filter(keep),
    skippedPacks: packsAll.filter(p => !keep(p)),
    questions: questions.filter(r => includeAgeGated || r.age_gate !== '18+'),
    skippedQuestions: questions.filter(r => !includeAgeGated && r.age_gate === '18+'),
  };
}

/** Idempotent SQL for packs, questions and pack membership (plus deactivation of skipped age-gated rows). */
export function contentSql(opts = {}) {
  const { packs, questions, skippedPacks, skippedQuestions } = readContent(opts);
  const out = [
    `-- Generated by supabase/scripts/content-sql.mjs from supabase/content/*.csv. Idempotent: upserts on slug / external_id.`,
    `-- age-gated (18+) packs and their questions: ${opts.includeAgeGated ? 'INCLUDED' : 'skipped, and deactivated if present (D33)'}`,
  ];

  if (packs.length) {
    out.push(
      `insert into public.question_packs (slug, title, description, is_premium, sort_order, age_gate, icon, active) values`,
      packs.map(p => `  (${q(p.slug)}, ${q(p.title)}, ${q(p.description)}, ${p.is_premium}, ${p.sort_order}, ${qn(p.age_gate)}, ${qn(p.icon)}, true)`).join(',\n'),
      `on conflict (slug) do update set title = excluded.title, description = excluded.description, is_premium = excluded.is_premium,
  sort_order = excluded.sort_order, age_gate = excluded.age_gate, icon = excluded.icon, active = true;`,
    );
  }
  if (questions.length) {
    const stages = s => (s.length ? `array[${s.map(q).join(', ')}]::public.couple_stage[]` : `'{}'::public.couple_stage[]`);
    out.push(
      `insert into public.questions (external_id, body, category, depth, stages, is_premium, daily_eligible, special, age_gate, sort_order, locale, active) values`,
      questions.map(r => `  (${q(r.external_id)}, ${q(r.body)}, ${q(r.category || 'general')}, ${r.depth}, ${stages(r.stages)}, ${r.is_premium}, ${r.daily_eligible}, ${r.special ? `${q(r.special)}::public.special_question` : 'null'}, ${qn(r.age_gate)}, ${r.sort_order}, 'en', true)`).join(',\n'),
      `on conflict (external_id) do update set body = excluded.body, category = excluded.category, depth = excluded.depth, stages = excluded.stages,
  is_premium = excluded.is_premium, daily_eligible = excluded.daily_eligible, special = excluded.special, age_gate = excluded.age_gate,
  sort_order = excluded.sort_order, locale = excluded.locale, active = true;`,
    );
    const members = questions.filter(r => r.pack_slug !== '');
    if (members.length) {
      out.push(
        `insert into public.pack_questions (pack_id, question_id, position)`,
        `select p.id, qu.id, v.position from (values`,
        members.map(r => `  (${q(r.pack_slug)}, ${q(r.external_id)}, ${Number(r.pack_position)})`).join(',\n'),
        `) as v(slug, external_id, position)`,
        `join public.question_packs p on p.slug = v.slug join public.questions qu on qu.external_id = v.external_id`,
        `on conflict (pack_id, question_id) do update set position = excluded.position;`,
      );
    }
  }
  if (skippedPacks.length) out.push(`update public.question_packs set active = false where slug in (${skippedPacks.map(p => q(p.slug)).join(', ')});`);
  if (skippedQuestions.length) out.push(`update public.questions set active = false where external_id in (${skippedQuestions.map(r => q(r.external_id)).join(', ')});`);
  return out.join('\n') + '\n';
}

/** CONTENT_INCLUDE_AGE_GATED=true turns the 18+ packs on. Anything else leaves them out. */
export const includeAgeGatedFromEnv = (env = process.env) => env.CONTENT_INCLUDE_AGE_GATED === 'true';
