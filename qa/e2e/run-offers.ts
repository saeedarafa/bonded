// QA-35: runs the one-device Maestro flows for the D52 day-3 gift and the D46 free answer hint on a
// simulator or emulator against the LOCAL Supabase stack, and checks the database afterwards.
// QA-48c: also the D57 exit and cancel offers (exit-* and cancel, below).
//
//   npm --prefix qa/e2e run offers -- <suite> --a <device-id> [--rc]
//   suites: gift | gift-none | hint | exit-p3 | exit-16 | exit-premium | exit-gift | cancel | exit | all
//   (exit = the five D57 suites; all = everything)
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
//
// D57 (QA-48c). Every exit/cancel suite needs a build WITH a RevenueCat key and the `exit30`
// offering (and `cancel30` for cancel). QA-51 (PO 2026-11-13): that key is the RevenueCat Test Store
// key (`test_…`, products `*_v2`, no store account needed) in the repo .env as
// EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY; a store sandbox key (`appl_`/`goog_`, ACCOUNTS 9b)
// works the same. Pass --rc (or RC_SANDBOX=1 / RC_TEST_STORE=1) to promise the build has it; the
// runner prints which key kind the env/.env holds (never the key). Without --rc the suites print SKIP
// with the reason and do not fail (a build without a key shows 16 "unavailable" and never asks for
// the exit offer).
// exit-p3    fresh-install, exit rows cleared. offers/exit-offer-p3.yaml: signed out, P3 first × ->
//            exit offer sheet -> "No thanks" -> 08; P3 second × -> 17. DB: nobody has an exit row
//            (signed out: the phone tells the server only after sign-in).
// exit-16    free-couple-packs + prepareExitOffer (never subscribed, no gift, no rows, no claims).
//            offers/exit-offer-16.yaml: Maya, 16 first × -> sheet -> "No thanks"; second × -> 17.
//            DB: Maya has exactly `paywall_close`, today's claims [exit_paywall_close]; Sam none.
// exit-premium premium-couple + prepareExitOfferPremium. offers/exit-offer-none-premium.yaml: Sam
//            (on Maya's plan) sees 16 "already Premium", no ×, no sheet. DB: no exit rows.
// exit-gift  free-couple-packs + prepareExitOfferGiftLive (day-3 gift live, unopened).
//            offers/exit-offer-none-gift.yaml: 14 by itself, "Not now", 16 first × -> 17 (gift_live).
//            DB: no exit row for Maya, the gift is still there.
// cancel     premium-couple + prepareExitOfferPremium, iOS only (Android: SKIP, D57 v1 has no
//            cancel offer there). offers/cancel-offer.yaml: Us -> Premium -> cancel offer sheet ->
//            × -> Premium again -> store page. DB: Maya has exactly `cancel`. Also needs an active
//            sandbox yearly subscription for Maya's App User ID on that simulator.
// The states themselves are proven without a device in qa/contract/e2e-seeds.test.ts (CI).
// Build: gift/gift-none/hint one without a RevenueCat key (qa/e2e/README.md); exit-*/cancel one with
// the Test Store (or a sandbox) key (--rc). JUnit: qa/e2e/out/offers-*.xml, daily-*.xml.
// Env: SUPABASE_DB_URL / DB_URL (local only), MAILPIT_URL, MAESTRO, RC_SANDBOX, RC_TEST_STORE.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { databaseUrl, type Queryable } from '../scripts/seed-scenario.ts';
import {
  clearMail,
  isIosSimulator,
  maestro,
  MAYA,
  quietToday,
  SAM,
  seed,
  setReduceMotion,
  useDevices,
  type Result,
} from './lib.ts';
import {
  answeredToday,
  clearExitOfferRows,
  day3Row,
  dropDay3Gift,
  earnBadgeWithoutGift,
  earnDay3Gift,
  EXIT_BASE_SCENARIO,
  exitOfferTriggers,
  GIFT_BASE_SCENARIO,
  offerScreenClaims,
  prepareExitOffer,
  prepareExitOfferGiftLive,
  prepareExitOfferPremium,
  PREMIUM_SCENARIO,
} from '../scripts/offer-seeds.ts';

const HOUR_MS = 3_600_000;
/** 449 characters typed on 19 (FIXTURE- prefix for privacy greps; letters and spaces only). */
export const TEXT_449 = `FIXTURE-E2E Maya writes a long answer ${'a'.repeat(449)}`.slice(0, 449);

/** A result that did not run: printed as SKIP, never fails the run. */
export type OfferResult = Result & { skipped?: boolean };

export const SUITES = ['gift', 'gift-none', 'hint', 'exit-p3', 'exit-16', 'exit-premium', 'exit-gift', 'cancel', 'exit', 'all'];
const EXIT_SUITES = ['exit-p3', 'exit-16', 'exit-premium', 'exit-gift', 'cancel'];
export const NEEDS_RC = 'needs a RevenueCat key: run with --rc on a build made with the Test Store key (test_…, repo .env) or a store sandbox key, with the exit30/cancel30 offers';

/**
 * QA-51: which RevenueCat key the build env would get (process env first, then the repo .env):
 * `test-store` (`test_…`, PO 2026-11-13), `sandbox` (`appl_`/`goog_`) or `none`. Never returns the key.
 */
export function rcKeyKind(env: Record<string, string | undefined> = process.env): 'test-store' | 'sandbox' | 'none' {
  let key = env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  const dotenv = fileURLToPath(new URL('../../.env', import.meta.url));
  if (!key && existsSync(dotenv)) {
    const m = readFileSync(dotenv, 'utf8').match(/^EXPO_PUBLIC_REVENUECAT_(?:IOS|ANDROID)_KEY=["']?([^"'\s]+)/m);
    key = m?.[1];
  }
  if (!key) return 'none';
  return key.startsWith('test_') ? 'test-store' : /^(appl|goog)_/.test(key) ? 'sandbox' : 'none';
}

/** Whether `name` runs for the requested suite id (`exit` and `all` group them). */
const wants = (id: string, name: string) =>
  id === name || id === 'all' || (id === 'exit' && EXIT_SUITES.includes(name));

const rowsOf = async (db: Queryable) =>
  `Maya [${(await exitOfferTriggers(db, MAYA)).join(', ')}], Sam [${(await exitOfferTriggers(db, SAM)).join(', ')}]`;

/** D57 exit and cancel offers (QA-48c). Each one skips without --rc. */
async function exitSuites(db: Queryable, id: string, A: string, rc: boolean): Promise<OfferResult[]> {
  const results: OfferResult[] = [];
  const skip = (name: string, why = NEEDS_RC) => results.push({ name, ok: true, skipped: true, detail: why });

  if (wants(id, 'exit-p3')) {
    const name = 'exit-p3 (P3 first × -> exit offer sheet -> 08; second × -> 17)';
    if (!rc) skip(name);
    else {
      await seed(db, 'fresh-install');
      await clearExitOfferRows(db);
      setReduceMotion(A, false);
      const ok = await maestro({ flow: 'offers/exit-offer-p3.yaml', device: A });
      const maya = await exitOfferTriggers(db, MAYA);
      const sam = await exitOfferTriggers(db, SAM);
      results.push({
        name,
        ok: ok && maya.length === 0 && sam.length === 0,
        detail: `device ${ok ? 'ok' : 'FAILED'}, exit rows ${await rowsOf(db)} (want none: signed out)`,
      });
    }
  }
  if (wants(id, 'exit-16')) {
    const name = 'exit-16 (16 first × -> exit offer sheet; second × -> 17)';
    if (!rc) skip(name);
    else {
      await seed(db, EXIT_BASE_SCENARIO);
      await prepareExitOffer(db);
      await quietToday(db);
      setReduceMotion(A, false);
      const ok = await maestro({ flow: 'offers/exit-offer-16.yaml', device: A });
      const maya = await exitOfferTriggers(db, MAYA);
      const sam = await exitOfferTriggers(db, SAM);
      const claims = await offerScreenClaims(db, MAYA);
      results.push({
        name,
        ok: ok && maya.join() === 'paywall_close' && sam.length === 0 && claims.join() === 'exit_paywall_close',
        detail: `device ${ok ? 'ok' : 'FAILED'}, exit rows ${await rowsOf(db)}, Maya's claims today [${claims.join(', ')}]`,
      });
    }
  }
  if (wants(id, 'exit-premium')) {
    const name = 'exit-premium (Premium couple: 16 already Premium, no ×, never the sheet)';
    if (!rc) skip(name);
    else {
      await seed(db, PREMIUM_SCENARIO);
      await prepareExitOfferPremium(db);
      await quietToday(db);
      setReduceMotion(A, false);
      const ok = await maestro({ flow: 'offers/exit-offer-none-premium.yaml', device: A });
      const maya = await exitOfferTriggers(db, MAYA);
      const sam = await exitOfferTriggers(db, SAM);
      results.push({
        name,
        ok: ok && maya.length === 0 && sam.length === 0,
        detail: `device ${ok ? 'ok' : 'FAILED'}, exit rows ${await rowsOf(db)} (want none)`,
      });
    }
  }
  if (wants(id, 'exit-gift')) {
    const name = 'exit-gift (day-3 gift live: 16 first × -> 17, never the sheet)';
    if (!rc) skip(name);
    else {
      await seed(db, EXIT_BASE_SCENARIO);
      await prepareExitOfferGiftLive(db);
      await clearMail();
      setReduceMotion(A, false);
      const seeded = (await day3Row(db))?.first_opened_at === null;
      const ok = await maestro({ flow: 'offers/exit-offer-none-gift.yaml', device: A });
      const maya = await exitOfferTriggers(db, MAYA);
      const gift = await day3Row(db);
      results.push({
        name,
        ok: ok && seeded && maya.length === 0 && gift !== null,
        detail: `device ${ok ? 'ok' : 'FAILED'}, gift seeded unopened ${seeded}, still there ${gift !== null}, exit rows ${await rowsOf(db)}`,
      });
    }
  }
  if (wants(id, 'cancel')) {
    const name = 'cancel (Us -> Premium: cancel offer once, then the store page)';
    if (!rc) skip(name);
    else if (!isIosSimulator(A)) skip(name, 'iOS only (D57 v1: Android opens the Play page directly, no cancel offer)');
    else {
      await seed(db, PREMIUM_SCENARIO);
      await prepareExitOfferPremium(db);
      await quietToday(db);
      setReduceMotion(A, false);
      const ok = await maestro({ flow: 'offers/cancel-offer.yaml', device: A });
      const maya = await exitOfferTriggers(db, MAYA);
      const claims = await offerScreenClaims(db, MAYA);
      results.push({
        name,
        ok: ok && maya.join() === 'cancel' && claims.join() === 'exit_cancel',
        detail: `device ${ok ? 'ok' : 'FAILED'}, exit rows ${await rowsOf(db)}, Maya's claims today [${claims.join(', ')}]`,
      });
    }
  }
  return results;
}

async function suite(db: Queryable, id: string, A: string, rc: boolean): Promise<OfferResult[]> {
  const results: OfferResult[] = [];
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
  results.push(...(await exitSuites(db, id, A, rc)));
  return results;
}

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const id = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--a');
  const A = arg(argv, '--a');
  const rc = argv.includes('--rc') || process.env.RC_SANDBOX === '1' || process.env.RC_TEST_STORE === '1';
  if (rc) {
    const kind = rcKeyKind();
    console.log(`RevenueCat key in env/.env: ${kind}`);
    if (kind === 'none') console.warn('warning: --rc, but no RevenueCat key in env/.env; the build must have one');
  }
  useDevices(A);
  if (!id || !SUITES.includes(id) || !A) {
    console.error(`usage: npm --prefix qa/e2e run offers -- <${SUITES.join('|')}> --a <device> [--rc]`);
    process.exit(2);
  }
  // Without --rc the D57 suites only print SKIP and touch nothing: no database needed (CI runs
  // `offers -- exit --a none` this way as a smoke check of the runner).
  if (!rc && (id === 'exit' || EXIT_SUITES.includes(id))) {
    const noDb: Queryable = { query: () => Promise.reject(new Error('no database without --rc')) };
    const results = await exitSuites(noDb, id, A, rc);
    for (const r of results) console.log(`SKIP  ${r.name}  (${r.detail ?? ''})`);
    process.exit(results.every((r) => r.skipped) ? 0 : 1);
  }
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const results = await suite(client, id, A, rc);
    for (const r of results) {
      console.log(`${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail ?? ''})`);
    }
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
