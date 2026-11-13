// QA-35: database states for the D52 day-3 gift E2E flows (qa/e2e/run-offers.ts), on top of a dev seed
// scenario. Shared with qa/contract/e2e-seeds.test.ts, which proves on the local stack (in CI) that
// each state is what the flow expects, so a device run only fails on the app.
//
// Plain TypeScript that Node 24 runs as is (type stripping); no imports, so vitest and node both load it.
// Lives in qa/scripts (own tsconfig, no expo base) so the contract suite can import it in the db-reset
// job, where the app dependencies (expo/tsconfig.base) are not installed.

/** pg.Client or anything with the same query(). */
export type Db = { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

export const MAYA = '00000000-0000-4000-a000-00000000a001';
export const SAM = '00000000-0000-4000-a000-00000000a002';
export const COUPLE = '00000000-0000-4000-b000-0000000000c1';

/** The scenario both gift states start from: maya_sam paired 2 days ago, both answered both days (streak 2), free. */
export const GIFT_BASE_SCENARIO = 'free-couple-packs';

/**
 * Private persona state the dev seed does not wipe (it is person-keyed, BE-47): `premium_history`
 * left by an earlier Premium scenario (premium-couple, missed-day-premium-saver) would make the
 * couple "ever subscribed" and no gift is created; today's `offer_screens` claim from an earlier run
 * would stop Today from opening 14 by itself; an exit-offer row (D61) bars the gift. Local personas only.
 */
async function clearOfferHistory(db: Db) {
  await db.query('delete from private.premium_history where user_id in ($1, $2)', [MAYA, SAM]);
  // D61 (BE-62 (b)): any exit-offer row of either partner (a `cancel` run, an old paywall_close)
  // bars the day-3 gift, and the dev seed keeps private.exit_offers.
  await db.query('delete from private.exit_offers where user_id in ($1, $2)', [MAYA, SAM]);
  await db.query('delete from private.offer_screens where user_id in ($1, $2)', [MAYA, SAM]);
}

/**
 * The couple reaches 3 days in a row now: the streak trigger awards `streak-3` with awarded_at now
 * (their first one), and BE-47's badge trigger creates the `day3` row when the couple may have it.
 * last_completed_on stays yesterday, so Today shows a fresh day with nobody answered.
 */
async function reachThreeDays(db: Db) {
  await db.query(
    `update couple_streaks set current = 3, longest = greatest(longest, 3) where couple_id = $1 and current < 3`,
    [COUPLE],
  );
}

/**
 * gift: a free couple, never subscribed, that earned its first 3-day badge today. The `day3`
 * offer is live and unopened (get_offer: eligible, no clock). Call after GIFT_BASE_SCENARIO.
 */
export async function earnDay3Gift(db: Db) {
  await clearOfferHistory(db);
  await reachThreeDays(db);
}

/**
 * gift-none: the same couple, but Sam once had Premium (an expired yearly entitlement: he
 * subscribed before and it lapsed), so the couple is free today yet "ever subscribed" (D52): the
 * 3-day badge earns no gift, Today shows the 52b sheet and no chip. Call after GIFT_BASE_SCENARIO.
 */
export async function earnBadgeWithoutGift(db: Db) {
  await clearOfferHistory(db);
  await db.query(
    `insert into entitlements (user_id, is_active, product_id, store, expires_at, updated_at)
     values ($1, false, 'yearly_v2', 'app_store', now() - interval '20 days', now() - interval '20 days')
     on conflict (user_id) do update set is_active = false, product_id = 'yearly_v2',
       expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    [SAM],
  );
  await reachThreeDays(db);
}

/**
 * Seeds with a long streak (streak-11-*) cross 3 days while the dev seed builds them, so since
 * BE-47 they carry a live day-3 gift too, and Today opens 14 over the screen a flow wants. Flows
 * that are not about the gift drop it (the couple's row only; nothing else changes).
 */
export async function dropDay3Gift(db: Db) {
  await db.query(`delete from couple_offers where couple_id = $1 and kind = 'day3'`, [COUPLE]);
}

export type Day3Row = { earned_at: Date; first_opened_at: Date | null; expires_at: Date | null };

/** maya_sam's `day3` row, or null. */
export async function day3Row(db: Db): Promise<Day3Row | null> {
  const r = await db.query(
    `select earned_at, first_opened_at, expires_at from couple_offers where couple_id = $1 and kind = 'day3'`,
    [COUPLE],
  );
  return (r.rows[0] as Day3Row | undefined) ?? null;
}

/** The streak-3 award for maya_sam, or null. */
export async function streak3AwardedAt(db: Db): Promise<Date | null> {
  const r = await db.query(
    `select awarded_at from badge_awards where couple_id = $1 and badge_slug = 'streak-3'`,
    [COUPLE],
  );
  return (r.rows[0]?.awarded_at as Date | undefined) ?? null;
}

/** Today's full-screen offer claims (private.offer_screens) for a persona: screen names. */
export async function offerScreenClaims(db: Db, user: string): Promise<string[]> {
  const r = await db.query(`select screen from private.offer_screens where user_id = $1 order by shown_at`, [user]);
  return r.rows.map((x) => String(x.screen));
}

/** Answers by a persona to maya_sam's daily question for today's row (latest assigned_for). */
export async function answeredToday(db: Db, user: string): Promise<boolean> {
  const r = await db.query(
    `select 1 from answers a join couple_questions cq on cq.id = a.couple_question_id
      where cq.couple_id = $1 and cq.source = 'daily' and a.user_id = $2
        and cq.assigned_for = (select max(assigned_for) from couple_questions where couple_id = $1 and source = 'daily')`,
    [COUPLE, user],
  );
  return r.rows.length > 0;
}

// ───────────── QA-48c: D57 exit and cancel offers (run-offers exit-* / cancel) ─────────────

/** The scenario the exit-offer-16 state starts from: maya_sam free, streak 2, no gift. */
export const EXIT_BASE_SCENARIO = GIFT_BASE_SCENARIO;
/** Maya has her own App Store yearly entitlement; Sam is on her plan. */
export const PREMIUM_SCENARIO = 'premium-couple';

/**
 * Wipe exit-offer rows (once per person per trigger, ever: a row from an earlier run means 17 on
 * the first ×) and today's offer-screen claims (`daily_limit`). Keeps premium_history: on
 * premium-couple Maya's own entitlement is the point. Local personas only.
 */
export async function clearExitOfferRows(db: Db) {
  await db.query('delete from private.exit_offers where user_id in ($1, $2)', [MAYA, SAM]);
  await db.query('delete from private.offer_screens where user_id in ($1, $2)', [MAYA, SAM]);
}

/**
 * exit-16: free, never subscribed (an earlier Premium scenario's person-keyed premium_history
 * would make Maya `not_intro_eligible`), no gift, nothing shown before. Call after EXIT_BASE_SCENARIO.
 */
export async function prepareExitOffer(db: Db) {
  await clearExitOfferRows(db);
  await clearOfferHistory(db);
}

/** exit-gift: as exit-16, plus the couple's day-3 gift live and unopened (`gift_live`). */
export async function prepareExitOfferGiftLive(db: Db) {
  await prepareExitOffer(db);
  await earnDay3Gift(db);
}

/** exit-premium / cancel: call after PREMIUM_SCENARIO; no exit-offer rows and no claims today. */
export async function prepareExitOfferPremium(db: Db) {
  await clearExitOfferRows(db);
}

/** A persona's `private.exit_offers` triggers (sorted). */
export async function exitOfferTriggers(db: Db, user: string): Promise<string[]> {
  const r = await db.query('select trigger from private.exit_offers where user_id = $1 order by trigger', [user]);
  return r.rows.map((x) => String(x.trigger));
}

// ───────────── QA-52: D61 one discount per person ─────────────

/**
 * gift-after-offer (D61 (4), BE-62 (b)): the free, never-subscribed couple reaches its first 3-day
 * badge now, but `user` was offered the 30% before (a `cancel` exit-offer row two days ago, as the
 * in-app cancel offer or the cancellation push leaves it), so the server creates no `day3` gift.
 * Call after GIFT_BASE_SCENARIO.
 */
export async function earnBadgeAfterExitOffer(db: Db, user: string) {
  await clearOfferHistory(db);
  await db.query(
    `insert into private.exit_offers(user_id, trigger, first_shown_at) values ($1, 'cancel', now() - interval '2 days')`,
    [user],
  );
  await reachThreeDays(db);
}
