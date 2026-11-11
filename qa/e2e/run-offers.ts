// QA-35: runs the one-device Maestro flows for the D52 day-3 gift and the D46 free answer hint on a
// simulator or emulator against the LOCAL Supabase stack, and checks the database afterwards.
//
//   npm --prefix qa/e2e run offers -- <suite> --a <device-id>
//   suites: gift | gift-none | hint | all
//
// gift       free-couple-packs + earnDay3Gift: Maya and Sam (free, never subscribed) earn their first
//            3-day badge now, so the server holds an unopened `day3` gift. offers/day3-gift.yaml: Today
//            opens 14 by itself, "Not now", chip "You earned a gift · Open" -> 14 -> "Open the gift" ->
//            15 with the 12-hour countdown -> "Not now" -> Today chip counting down. DB: the gift was
//            opened once, expires_at = first_opened_at + 12 h, Maya's one full-screen claim today is `gift`.
// gift-none  free-couple-packs + earnBadgeWithoutGift: same badge, but Sam subscribed once (lapsed), so
//            no gift (D52 "never subscribed"). offers/day3-gift-none.yaml: 52b, no 14, no chip. DB: no row.
// hint       streak-11-your-turn (free) with the seed's day-3 gift dropped. daily/answer-hint-19d.yaml:
//            449 characters no hint, 450 "50 left. Premium: 2000", tap -> paywall 16. DB: Maya saved nothing.
// The states themselves are proven without a device in qa/contract/e2e-seeds.test.ts (CI).
// Build: one without a RevenueCat key (qa/e2e/README.md). JUnit: qa/e2e/out/offers-*.xml, daily-*.xml.
// Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL, MAESTRO.
import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import { clearMail, maestro, MAYA, seed, setReduceMotion, useDevices, type Result } from './lib.ts';
import {
  answeredToday,
  day3Row,
  dropDay3Gift,
  earnBadgeWithoutGift,
  earnDay3Gift,
  GIFT_BASE_SCENARIO,
  offerScreenClaims,
} from '../scripts/offer-seeds.ts';

const HOUR_MS = 3_600_000;
/** 449 characters typed on 19 (FIXTURE- prefix for privacy greps; letters and spaces only). */
export const TEXT_449 = `FIXTURE-E2E Maya writes a long answer ${'a'.repeat(449)}`.slice(0, 449);

async function suite(db: Queryable, id: string, A: string): Promise<Result[]> {
  const results: Result[] = [];
  if (id === 'gift' || id === 'all') {
    await seed(db, GIFT_BASE_SCENARIO);
    await earnDay3Gift(db);
    await clearMail();
    setReduceMotion(A, false);
    const before = await day3Row(db);
    const ok = await maestro({ flow: 'offers/day3-gift.yaml', device: A });
    const row = await day3Row(db);
    const span = row?.first_opened_at && row.expires_at
      ? new Date(row.expires_at).getTime() - new Date(row.first_opened_at).getTime() : null;
    const claims = await offerScreenClaims(db, MAYA);
    const seeded = !!before && before.first_opened_at === null;
    results.push({
      name: 'gift (14 by itself, chip unopened -> 14 -> 15 12 h countdown -> Today chip live)',
      ok: ok && seeded && span === 12 * HOUR_MS && claims.join() === 'gift',
      detail: `device ${ok ? 'ok' : 'FAILED'}, seeded unopened ${seeded}, clock ${span === null ? 'not started' : `${span / HOUR_MS} h`}, Maya's claims today [${claims.join(', ')}]`,
    });
  }
  if (id === 'gift-none' || id === 'all') {
    await seed(db, GIFT_BASE_SCENARIO);
    await earnBadgeWithoutGift(db);
    await clearMail();
    setReduceMotion(A, false);
    const ok = await maestro({ flow: 'offers/day3-gift-none.yaml', device: A });
    const row = await day3Row(db);
    results.push({
      name: 'gift-none (ever subscribed: 52b, no 14, no chip)',
      ok: ok && row === null,
      detail: `device ${ok ? 'ok' : 'FAILED'}, day3 row ${row ? 'EXISTS' : 'none'}`,
    });
  }
  if (id === 'hint' || id === 'all') {
    await seed(db, 'streak-11-your-turn');
    await dropDay3Gift(db);
    await clearMail();
    setReduceMotion(A, false);
    const ok = await maestro({ flow: 'daily/answer-hint-19d.yaml', device: A, env: { TEXT_449 } });
    const saved = await answeredToday(db, MAYA);
    results.push({
      name: 'hint (19: no offer at 449; 19d at 450 opens 16; nothing saved)',
      ok: ok && !saved,
      detail: `device ${ok ? 'ok' : 'FAILED'}, Maya answered ${saved}`,
    });
  }
  return results;
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const id = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--a');
  const A = arg(argv, '--a');
  useDevices(A);
  if (!id || !['gift', 'gift-none', 'hint', 'all'].includes(id) || !A) {
    console.error('usage: npm --prefix qa/e2e run offers -- <gift|gift-none|hint|all> --a <device>');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const results = await suite(client, id, A);
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail ?? ''})`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(`e2e offers: ${e.message}`);
    process.exit(1);
  });
}
