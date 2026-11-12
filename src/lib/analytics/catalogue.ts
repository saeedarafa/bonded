import { ERROR_CODES } from '@/lib/errors';

/**
 * The analytics catalogue (D54, docs/ANALYTICS.md §2–§3). One property spec per event; `track()`
 * takes exactly these properties, typed from the specs below, and the same specs are checked
 * again at runtime before anything leaves the device (`sanitizeEvent`).
 *
 * There is no free-text kind. A string property is either one value of a fixed list, a uuid, a
 * route name, a lowercase slug (badge ids), an emoji from the picker, a version or a timestamp,
 * and each of those is checked by shape at runtime: answer or message text, names, emails,
 * invite codes and key-date titles can't pass any of them. Anything else is dropped.
 *
 * To add an event: add it to ANALYTICS.md (lead) and here in the same PR.
 */

type Flags = { optional?: true; nullable?: true };

export type Spec = Flags &
  (
    | { kind: 'bool' }
    /** A whole number >= 0 (counts, days, buckets of hours). */
    | { kind: 'count'; max?: number }
    /** A whole number, may be negative (hours after the ritual time). */
    | { kind: 'int' }
    | { kind: 'enum'; values: readonly string[] }
    | { kind: 'enumList'; values: readonly string[] }
    | { kind: 'uuid' }
    | { kind: 'slug' }
    | { kind: 'emoji' }
    | { kind: 'route' }
    | { kind: 'version' }
    | { kind: 'date' }
    | { kind: 'datetime' }
  );

const bool = () => ({ kind: 'bool' }) as const;
const count = (max?: number) => ({ kind: 'count', ...(max === undefined ? {} : { max }) }) as const;
const int = () => ({ kind: 'int' }) as const;
const oneOf = <const V extends string>(values: readonly V[]) =>
  ({ kind: 'enum', values }) as { kind: 'enum'; values: readonly V[] };
const listOf = <const V extends string>(values: readonly V[]) =>
  ({ kind: 'enumList', values }) as { kind: 'enumList'; values: readonly V[] };
const uuid = () => ({ kind: 'uuid' }) as const;
const slug = () => ({ kind: 'slug' }) as const;
const emoji = () => ({ kind: 'emoji' }) as const;
const route = () => ({ kind: 'route' }) as const;
const version = () => ({ kind: 'version' }) as const;
const date = () => ({ kind: 'date' }) as const;
const datetime = () => ({ kind: 'datetime' }) as const;
const opt = <S extends Spec>(s: S) => ({ ...s, optional: true }) as S & { optional: true };
const nullable = <S extends Spec>(s: S) => ({ ...s, nullable: true }) as S & { nullable: true };

// ---------- Fixed lists (kept equal to the feature constants by analytics tests) ----------

/** Board ids (design-handoff/screens.json) that a route or a property can name. */
export const SCREEN_IDS = [
  '01',
  '05',
  '07',
  '02',
  '03',
  '04',
  '06',
  'T1',
  'N',
  'L',
  'P2',
  'P3',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  'J2',
  'J3',
  'J4',
  'J5',
  'J6',
  'J8',
  'J10',
  '14',
  '15',
  '16',
  '18',
  '19',
  '20',
  '21',
  '22',
  '25',
  '27',
  '29',
  '30',
  '31',
  '32',
  '33',
  '35',
  '40',
  '41',
  '42',
  '43',
  '47',
  '52',
  '58',
] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

export const ONBOARDING_STEP_IDS = [
  '01',
  '05',
  '07',
  '02',
  '03',
  '04',
  '06',
  'T1',
  'N',
  'L',
  'P2',
  'P3',
] as const;
export const STAGE_IDS = ['dating', 'living_together', 'engaged_married', 'long_distance'] as const;
export const GOAL_IDS = [
  'deep_talks',
  'laughing',
  'romance',
  'future',
  'hard_conversations',
  'learning',
] as const;
/** P3 `paywall_viewed.goal_keys` (MOB-75): the goals whose feeling lines showed, or `general`. */
export const GOAL_LINE_KEYS = [...GOAL_IDS, 'general'] as const;
export const LAST_LEARNED_IDS = ['this_week', 'this_month', 'cant_remember'] as const;
export const RITUAL_TIME_IDS = ['08:00', '12:30', '21:00', 'other'] as const;
export const SIGN_IN_METHODS = ['apple', 'google', 'email'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export const PUSH_TYPE_IDS = [
  'ritual_reminder',
  'partner_answered',
  'both_answered',
  'thread_activity',
  'last_call',
  'nudge',
  'partner_joined',
  'partner_premium',
  'weekly_recap',
  'trial_ending',
  'offer_ending',
  'little_thing',
] as const;
export const PUSH_TOGGLE_IDS = [
  'daily_reminder',
  'partner_answered',
  'replies',
  'last_call',
  'nudges',
  'little_things',
  'tips',
] as const;
export const GESTURE_KINDS = ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'] as const;
export const KEY_DATE_KINDS = ['together_since', 'anniversary', 'birthday'] as const;
export const FEEDBACK_TAG_IDS = [
  'repetitive_questions',
  'partner_forgets',
  'reminder_timing',
  'something_broke',
  'something_else',
] as const;
export const OFFERING_IDS = ['default', 'day3'] as const;
export const OFFER_KINDS = ['day3'] as const;
export const PURCHASE_FAILURES = [
  'network',
  'alreadyOwned',
  'pending',
  'payment',
  'unavailable',
  'unknown',
] as const;
/** `src/lib/errors.ts` kinds: the database codes plus the app's own. Never a message. */
export const ERROR_KINDS = [
  ...ERROR_CODES,
  'ANSWER_TOO_LONG',
  'VOICE_TOO_LONG',
  'VOICE_DENIED',
  'VOICE_TOO_LARGE',
  'VOICE_FORMAT',
  'SIGNED_OUT',
  'NETWORK',
  'UNKNOWN',
] as const;
export const LENGTH_BUCKETS = ['<50', '50-150', '150+'] as const;
export const DURATION_BUCKETS = ['<15s', '15-45s', '45s+'] as const;
export type LengthBucket = (typeof LENGTH_BUCKETS)[number];
export type DurationBucket = (typeof DURATION_BUCKETS)[number];
/** `15` = the day-3 gift coupon: purchase events only (its view is `gift_offer_viewed`). */
export const PAYWALL_IDS = ['P3', '16', '17', '34', 'J8', '15'] as const;
export const PAYWALL_TRIGGERS = [
  'onboarding',
  'voice',
  'long_answer',
  'little_things_limit',
  'streak_saver',
  'settings',
  'pack',
  'recap',
  'dark',
  'gift',
  'history',
] as const;
export const PRODUCTS = ['yearly_trial', 'monthly'] as const;

const step = oneOf(ONBOARDING_STEP_IDS);
const method = oneOf(SIGN_IN_METHODS);
const answerKind = oneOf(['text', 'voice']);
const lengthSpec = oneOf(LENGTH_BUCKETS);
const durationSpec = oneOf(DURATION_BUCKETS);
const gesture = oneOf(GESTURE_KINDS);
const paywall = oneOf(PAYWALL_IDS);
const product = oneOf(PRODUCTS);
const voiceContext = oneOf(['answer', 'message']);

// ---------- §3 Events ----------

export const EVENTS = {
  // 3.1 App and session
  app_opened: {
    source: oneOf(['icon', 'push', 'widget', 'link']),
    push_type: opt(oneOf(PUSH_TYPE_IDS)),
  },
  screen_viewed: { screen: route(), screen_id: opt(oneOf(SCREEN_IDS)) },
  deep_link_opened: { kind: oneOf(['invite', 'auth', 'push', 'widget', 'other']), valid: bool() },
  analytics_opted_out: {},

  // 3.2 Onboarding funnel
  onboarding_started: { resumed: bool() },
  onboarding_step_viewed: { step, step_index: count(20) },
  onboarding_step_completed: {
    step,
    stage: opt(oneOf(STAGE_IDS)),
    last_learned: opt(oneOf(LAST_LEARNED_IDS)),
    goals: opt(listOf(GOAL_IDS)),
    ritual_time: opt(oneOf(RITUAL_TIME_IDS)),
    names_given: opt(bool()),
  },
  onboarding_back_pressed: { step },
  first_answer_written: { length_bucket: lengthSpec },
  reminder_permission_requested: { screen: oneOf(SCREEN_IDS) },
  reminder_permission_result: { granted: bool(), screen: oneOf(SCREEN_IDS) },
  reminder_soft_ask_declined: { screen: oneOf(SCREEN_IDS) },
  plan_viewed: {},
  onboarding_completed: { duration_s: count(), purchased_on_p3: bool() },

  // 3.3 Sign-in and account
  sign_in_viewed: { context: oneOf(['onboarding', 'join', 'returning']) },
  sign_in_started: { method },
  email_code_requested: { resend: bool() },
  sign_in_failed: { method, error_code: oneOf(ERROR_KINDS) },
  signed_up: { method },
  signed_in: { method },
  signed_out: {},
  onboarding_synced: { t1_saved: bool() },
  account_delete_started: {},
  account_deleted: {},

  // 3.4 Pairing funnel
  solo_couple_created: {},
  pair_invite_viewed: {},
  pair_invite_created: { kind: oneOf(['link', 'code']) },
  pair_invite_shared: { channel: oneOf(['share_sheet', 'copy_link', 'copy_code']) },
  pair_waiting_viewed: { hours_since_invite: count() },
  invite_link_opened: { signed_in: bool(), valid: bool() },
  join_code_entered: { result: oneOf(['ok', 'invalid', 'rate_limited', 'full']) },
  join_started: { via: oneOf(['link', 'code']) },
  join_request_pending: {},
  join_request_answered: { approved: bool() },
  join_archive_confirm_shown: {},
  join_completed: { via: oneOf(['link', 'code']), archived_solo: bool() },
  paired: { role: oneOf(['starter', 'joiner']), hours_from_signup: count() },
  partner_left_viewed: {},
  unpaired: { days_paired: count() },

  // 3.5 Daily loop
  daily_question_viewed: {
    question_id: uuid(),
    pack_id: nullable(uuid()),
    partner_answered: bool(),
    i_answered: bool(),
    hours_after_ritual: int(),
  },
  answer_started: { question_id: uuid(), kind: answerKind },
  answer_draft_restored: {},
  answer_submitted: {
    question_id: uuid(),
    pack_id: nullable(uuid()),
    kind: answerKind,
    length_bucket: opt(lengthSpec),
    duration_bucket: opt(durationSpec),
    partner_answered: bool(),
    edited: bool(),
    offline_queued: bool(),
  },
  answer_queued_offline: {},
  answer_edited: { question_id: uuid() },
  answer_locked_viewed: { question_id: uuid() },
  reveal_started: { question_id: uuid() },
  answer_revealed: {
    question_id: uuid(),
    pack_id: nullable(uuid()),
    hours_since_both_answered: count(),
  },
  reaction_added: { emoji: emoji(), target: oneOf(['answer', 'message']) },
  thread_opened: { question_id: uuid(), unread_count: count() },
  thread_message_sent: {
    question_id: uuid(),
    kind: answerKind,
    length_bucket: opt(lengthSpec),
    duration_bucket: opt(durationSpec),
  },
  voice_recording_started: { context: voiceContext },
  voice_recording_finished: { context: voiceContext, duration_bucket: durationSpec },
  voice_recording_discarded: { context: voiceContext, duration_bucket: opt(durationSpec) },
  voice_played: { context: voiceContext, own: bool() },
  question_ended_viewed: {},

  // 3.6 Streaks, badges, milestones, recap
  streak_extended: { streak: count() },
  streak_broken: { previous_streak: count() },
  streak_saver_viewed: { streak: count() },
  streak_saver_used: { streak: count() },
  badge_earned: { badge_id: slug() },
  badges_viewed: { earned_count: count() },
  milestone_viewed: { n: count() },
  recap_viewed: { week: date(), full: bool() },
  review_prompt_requested: {},

  // 3.7 History, packs, little things, key dates, widgets
  history_viewed: { items: count() },
  history_item_opened: { question_id: uuid(), days_ago: count() },
  packs_viewed: {},
  pack_opened: { pack_id: uuid(), locked: bool() },
  pack_question_started: { pack_id: uuid(), question_id: uuid() },
  pack_question_blocked: { pack_id: uuid() },
  little_thing_sent: { kind: gesture, amount: count(100) },
  little_thing_undone: { kind: gesture },
  little_thing_received_viewed: { kind: gesture },
  little_thing_limit_hit: { kind: gesture },
  key_date_added: { type: oneOf(KEY_DATE_KINDS) },
  key_date_removed: { type: oneOf(KEY_DATE_KINDS) },
  widget_tapped: { widget: oneOf(['today', 'countdown', 'partner_answered']) },
  feedback_opened: {},
  feedback_sent: { rating: opt(oneOf(FEEDBACK_TAG_IDS)) },
  check_in_answered: { score: count(5) },

  // 3.8 Notifications
  push_opened: { type: oneOf(PUSH_TYPE_IDS), minutes_since_sent: opt(count()) },
  push_setting_changed: { type: oneOf(PUSH_TOGGLE_IDS), enabled: bool() },
  ritual_time_changed: { ritual_time: oneOf(RITUAL_TIME_IDS) },
  push_permission_changed: { granted: bool() },

  // 3.9 Money funnel
  paywall_viewed: {
    paywall,
    trigger: oneOf(PAYWALL_TRIGGERS),
    offering: opt(oneOf(OFFERING_IDS)),
    trial_eligible: opt(bool()),
    goal_keys: opt(listOf(GOAL_LINE_KEYS)),
  },
  paywall_plan_selected: { paywall, product },
  paywall_closed: { paywall },
  exit_sheet_viewed: {},
  continued_free: { paywall },
  purchase_started: { paywall, product, offering: oneOf(OFFERING_IDS) },
  purchase_cancelled: { paywall, product },
  purchase_failed: { paywall, product, error_code: oneOf(PURCHASE_FAILURES) },
  purchase_completed: { paywall, product, is_trial: bool(), before_sign_in: bool() },
  premium_confirmed: { seconds_after_purchase: count() },
  restore_tapped: {},
  restore_completed: { found: bool() },
  gift_offer_viewed: { offer_kind: oneOf(OFFER_KINDS) },
  gift_offer_claimed: { offer_kind: oneOf(OFFER_KINDS) },
  gift_offer_dismissed: { offer_kind: oneOf(OFFER_KINDS) },
  both_premium_viewed: {},
} as const satisfies Record<string, Record<string, Spec>>;

// ---------- §2 Properties on every event, and person properties ----------

export const SUPER_PROPERTIES = {
  app_version: opt(version()),
  build: opt(version()),
  platform: opt(oneOf(['ios', 'android', 'web'])),
  os_version: opt(version()),
  signed_in: opt(bool()),
  couple_state: opt(oneOf(['none', 'solo', 'paired', 'ended'])),
  couple_id: opt(uuid()),
  is_premium: opt(bool()),
  days_since_signup: opt(count()),
  days_since_paired: opt(count()),
  streak: opt(count()),
  is_test_account: opt(bool()),
} as const satisfies Record<string, Spec>;

export const PERSON_PROPERTIES = {
  signup_method: opt(method),
  signed_up_at: opt(datetime()),
  stage: opt(oneOf(STAGE_IDS)),
  goals: opt(listOf(GOAL_IDS)),
  ritual_time: opt(oneOf(RITUAL_TIME_IDS)),
  push_enabled: opt(bool()),
  paired_at: opt(datetime()),
  is_premium: opt(bool()),
  plan: opt(oneOf(['yearly', 'monthly', 'none'])),
  role: opt(oneOf(['starter', 'joiner'])),
} as const satisfies Record<string, Spec>;

// ---------- Types derived from the specs ----------

type Value<S> = S extends { kind: 'bool' }
  ? boolean
  : S extends { kind: 'count' | 'int' }
    ? number
    : S extends { kind: 'enum'; values: readonly (infer V)[] }
      ? V
      : S extends { kind: 'enumList'; values: readonly (infer V)[] }
        ? readonly V[]
        : string;
type Field<S> = S extends { nullable: true } ? Value<S> | null : Value<S>;
type RequiredKeys<T> = { [K in keyof T]: T[K] extends { optional: true } ? never : K }[keyof T];
type OptionalKeys<T> = { [K in keyof T]: T[K] extends { optional: true } ? K : never }[keyof T];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type PropsOf<T> = Simplify<
  { [K in RequiredKeys<T>]: Field<T[K]> } & { [K in OptionalKeys<T>]?: Field<T[K]> }
>;

export type EventName = keyof typeof EVENTS;
export type EventProps<E extends EventName> = PropsOf<(typeof EVENTS)[E]>;
export type SuperProperties = PropsOf<typeof SUPER_PROPERTIES>;
export type PersonProperties = PropsOf<typeof PERSON_PROPERTIES>;

export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];

// ---------- Runtime checks ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
/**
 * `app/(tabs)/today/answer`, `app/(tabs)/history/[questionId]`: file route names, never values.
 * Plain segments are lowercase words (no digits), so an id or an invite code can't pass.
 */
const ROUTE =
  /^app(?:\/(?:\([a-z]+(?:-[a-z]+)*\)|\[[A-Za-z]{1,24}\]|[a-z]{1,24}(?:-[a-z]{1,24})*))*$/;
const VERSION = /^[0-9][0-9A-Za-z.]{0,23}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Emoji from the reaction picker: pictographs, flags, keycaps and their joiners only. */
function isEmoji(value: string): boolean {
  if (value.length === 0 || value.length > 16) return false;
  const points = Array.from(value, (c) => c.codePointAt(0) ?? 0);
  const keycap = points.includes(0x20e3);
  let pictographs = 0;
  for (const p of points) {
    const joiner = p === 0x200d || p === 0xfe0f || p === 0x20e3 || (p >= 0xe0020 && p <= 0xe007f);
    const tone = p >= 0x1f3fb && p <= 0x1f3ff;
    const keycapBase = keycap && (p === 0x23 || p === 0x2a || (p >= 0x30 && p <= 0x39));
    const pictograph =
      (p >= 0x1f000 && p <= 0x1faff) ||
      (p >= 0x2190 && p <= 0x21ff) ||
      (p >= 0x2300 && p <= 0x23ff) ||
      (p >= 0x25a0 && p <= 0x27bf) ||
      (p >= 0x2900 && p <= 0x297f) ||
      (p >= 0x2b00 && p <= 0x2bff) ||
      [0xa9, 0xae, 0x203c, 0x2049, 0x2122, 0x2139, 0x3030, 0x303d, 0x3297, 0x3299].includes(p);
    if (pictograph || keycapBase) pictographs += 1;
    else if (!joiner && !tone) return false;
  }
  return pictographs > 0 && pictographs <= 8;
}

function checkValue(spec: Spec, value: unknown): boolean {
  if (value === null) return spec.nullable === true;
  switch (spec.kind) {
    case 'bool':
      return typeof value === 'boolean';
    case 'count':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        (spec.max === undefined || value <= spec.max)
      );
    case 'int':
      return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 100_000;
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
    case 'enumList':
      return (
        Array.isArray(value) &&
        value.length <= spec.values.length &&
        value.every((v) => typeof v === 'string' && spec.values.includes(v))
      );
    case 'uuid':
      return typeof value === 'string' && UUID.test(value);
    case 'slug':
      return typeof value === 'string' && value.length <= 40 && SLUG.test(value);
    case 'emoji':
      return typeof value === 'string' && isEmoji(value);
    case 'route':
      return typeof value === 'string' && value.length <= 80 && ROUTE.test(value);
    case 'version':
      return typeof value === 'string' && VERSION.test(value);
    case 'date':
      return typeof value === 'string' && DATE.test(value);
    case 'datetime':
      return typeof value === 'string' && DATETIME.test(value);
  }
}

/**
 * Keep only the keys a spec allows, with values of the right shape. Unknown keys and values that
 * fail their check are dropped (never sent); the result lists what was dropped for dev warnings.
 */
export function pickAllowed(
  specs: Record<string, Spec>,
  input: Record<string, unknown> | undefined,
): { props: Record<string, unknown>; dropped: string[] } {
  const props: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(input ?? {})) {
    const spec = Object.prototype.hasOwnProperty.call(specs, key) ? specs[key] : undefined;
    if (value === undefined) continue;
    if (spec && checkValue(spec, value)) props[key] = Array.isArray(value) ? [...value] : value;
    else dropped.push(key);
  }
  for (const [key, spec] of Object.entries(specs)) {
    if (!spec.optional && !(key in props)) dropped.push(key);
  }
  return { props, dropped };
}

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

/**
 * The event's own properties, checked. Null when the event is not in the catalogue or a required
 * property is missing or malformed (a half event would skew the funnels, so it is not sent).
 */
export function sanitizeEvent(
  name: string,
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!isEventName(name)) return null;
  const specs: Record<string, Spec> = EVENTS[name];
  const { props } = pickAllowed(specs, input);
  for (const [key, spec] of Object.entries(specs)) {
    if (!spec.optional && !(key in props)) return null;
  }
  return props;
}

export function sanitizeSuperProperties(input: Record<string, unknown>): Record<string, unknown> {
  return pickAllowed(SUPER_PROPERTIES, input).props;
}

export function sanitizePersonProperties(input: Record<string, unknown>): Record<string, unknown> {
  return pickAllowed(PERSON_PROPERTIES, input).props;
}

/** `length_bucket` for answers and messages: the length only, never the text. */
export function lengthBucket(length: number): LengthBucket {
  if (length < 50) return '<50';
  if (length <= 150) return '50-150';
  return '150+';
}

export function durationBucket(ms: number): DurationBucket {
  if (ms < 15_000) return '<15s';
  if (ms <= 45_000) return '15-45s';
  return '45s+';
}
