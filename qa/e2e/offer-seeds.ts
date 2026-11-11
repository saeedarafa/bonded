// QA-35: database states for the D52 day-3 gift E2E flows (run-offers.ts), on top of a dev seed
// scenario. Shared with qa/contract/e2e-seeds.test.ts, which proves on the local stack (in CI) that
// each state is what the flow expects, so a device run only fails on the app.
//
// Plain TypeScript that Node 24 runs as is (type stripping); no imports, so vitest and node both load it.

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
 * would stop Today from opening 14 by itself. Local personas only.
 */
async function clearOfferHistory(db: Db) {
  await db.query('delete from private.premium_history where user_id in ($1, $2)', [MAYA, SAM]);
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
     values ($1, false, 'yearly', 'app_store', now() - interval '20 days', now() - interval '20 days')
     on conflict (user_id) do update set is_active = false, product_id = 'yearly',
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
