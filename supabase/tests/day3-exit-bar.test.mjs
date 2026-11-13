// BE-62 (b) / D61 (4): a couple where either partner has any exit-offer row never earns, sees or
// opens the day-3 gift; a couple without one still does.
import assert from 'node:assert/strict';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';

const db = await createDb(defaultMigrations());
await db.exec(contentSql());
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const id = (n) => `00000000-0000-4000-a000-0000000062${String(n).padStart(2, '0')}`;
const users = Array.from({ length: 8 }, (_, i) => id(i + 10));
const [A, B, C, D, E, F, G, H] = users;
const as = async (uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating') c`)).rows[0].c;
  const invite = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [invite.c, invite.t]);
  return couple;
};
const earn = (couple, time) =>
  db.query(`insert into badge_awards(badge_slug, couple_id, awarded_at) values ('streak-3',$1,$2) on conflict do nothing`, [couple, time]);
const gift = async (couple) =>
  (await db.query(`select count(*)::int n from couple_offers where couple_id=$1 and kind='day3'`, [couple])).rows[0].n;
const get = async (uid, time) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return (await db.query(`select private.get_offer_at('day3', $1) j`, [time])).rows[0].j;
};
const offered = (uid, trigger) =>
  db.query(`insert into private.exit_offers(user_id, trigger, first_shown_at) values ($1, $2, '2026-11-14T10:00:00Z')`, [uid, trigger]);
const T0 = '2026-11-20T15:00:00Z';
const T1 = '2026-11-20T16:00:00Z';

try {
  await db.query(`insert into auth.users(id) values ${users.map((_, i) => `($${i + 1})`).join()}`, users);

  const ab = await pair(A, B); // control: nobody offered
  await earn(ab, T0);
  ok(await gift(ab) === 1 && (await get(A, T0)).eligible === true, 'control: couple without exit offers earns the day-3 gift');

  const cd = await pair(C, D); // C was offered the cancel 30%
  await offered(C, 'cancel');
  await earn(cd, T0);
  ok(await gift(cd) === 0, 'partner with a cancel exit-offer row: no gift earned');
  ok((await get(C, T0)).eligible === false && (await get(D, T0)).eligible === false,
    'either partner offered: get_offer(day3) not eligible for both');

  const ef = await pair(E, F); // historical paywall_close row on the other partner
  await offered(F, 'paywall_close');
  await earn(ef, T0);
  ok(await gift(ef) === 0, 'historical paywall_close row also bars the gift');

  const gh = await pair(G, H); // earned first, offered later
  await earn(gh, T0);
  ok(await gift(gh) === 1 && (await get(G, T0)).eligible === true, 'gift earned before any exit offer');
  await offered(H, 'cancel');
  ok((await get(G, T1)).eligible === false, 'once a partner is offered the 30%, the earned gift is no longer eligible');
  const live = (await db.query(`select private.day3_live_at($1, $2) l`, [gh, T1])).rows[0].l;
  ok(live === false, 'day3_live_at follows the bar');
  console.log(`\n${passed} passed`);
} finally {
  await db.close();
}
