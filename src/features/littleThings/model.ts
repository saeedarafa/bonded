/**
 * Little things (D48, MOB-58): the five gestures, the time-of-day pick, the fan layout and the
 * limits copy. Pure functions only: the limits themselves live in the database (BE-44).
 */

/** `send_little_thing(p_kind)` values (CONTRACTS §2), in the server's order. */
export const LITTLE_THING_KINDS = ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'] as const;
export type LittleThingKind = (typeof LITTLE_THING_KINDS)[number];

export function isLittleThingKind(value: unknown): value is LittleThingKind {
  return typeof value === 'string' && (LITTLE_THING_KINDS as readonly string[]).includes(value);
}

/** Up to 5 kisses in one send; the counter sends after this pause. */
export const KISS_MAX = 5;
export const KISS_BATCH_MS = 1000;
/** A hug is held for up to 5 s (`p_amount` in ms, 1 to 5000). */
export const HUG_MAX_MS = 5000;
/** A tap (or a hold shorter than this) still sends a hug: a 2-second one, like the prototype. */
export const HUG_TAP_MS = 1200;
export const HUG_TAP_AMOUNT = 2000;
/** The Undo toast stays 3 s (the server allows 5 s, for network delay). */
export const UNDO_MS = 3000;
/** The button's icon peeks at the next gesture this often (off with Reduce Motion). */
export const PEEK_EVERY_MS = 4200;
export const PEEK_SHOW_MS = 1400;

/**
 * D48: the button's icon and the fan's centre by the phone's local time:
 * 05:00–10:59 good morning, 11:00–19:59 hug, 20:00–04:59 goodnight.
 */
export function timeOfDayKind(now: Date): LittleThingKind {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'good_morning';
  if (h >= 11 && h < 20) return 'hug';
  return 'goodnight';
}

/** The fan, bottom-left to top-right: the time-of-day gesture in the middle (and larger). */
export function fanOrder(main: LittleThingKind): LittleThingKind[] {
  const rest = LITTLE_THING_KINDS.filter((k) => k !== main);
  return [rest[0]!, rest[1]!, main, rest[2]!, rest[3]!];
}

/** The fan is a quarter circle around the button (board 24c): 180° is left, 90° straight up. */
export const FAN_ANGLES = [180, 158, 134, 110, 90] as const;
export const FAN_RADIUS = 232;

/** Offsets (x right, y down) of each fan item's centre from the button's centre. */
export function fanOffsets(radius: number = FAN_RADIUS): { x: number; y: number }[] {
  return FAN_ANGLES.map((a) => ({
    x: Math.round(radius * Math.cos((a * Math.PI) / 180)),
    y: Math.round(-radius * Math.sin((a * Math.PI) / 180)),
  }));
}

/** What the server says about one kind today (`little_things_today()`, no counts). */
export type LittleThingState = { atLimit: boolean; morePremium: boolean };
export type LittleThingsToday = Record<LittleThingKind, LittleThingState>;

export const NOTHING_SENT: LittleThingsToday = {
  hug: { atLimit: false, morePremium: false },
  kiss: { atLimit: false, morePremium: false },
  goodnight: { atLimit: false, morePremium: false },
  good_morning: { atLimit: false, morePremium: false },
  miss_you: { atLimit: false, morePremium: false },
};

/** Rows of `little_thing_state` to a map; unknown kinds are ignored, missing ones are "not at limit". */
export function toToday(
  rows: readonly {
    kind: string | null;
    at_limit: boolean | null;
    more_with_premium: boolean | null;
  }[],
): LittleThingsToday {
  const out: LittleThingsToday = { ...NOTHING_SENT };
  for (const r of rows) {
    if (!isLittleThingKind(r.kind)) continue;
    out[r.kind] = { atLimit: r.at_limit === true, morePremium: r.more_with_premium === true };
  }
  return out;
}

/** The amount for `send_little_thing`: kisses 1..5, a hug in ms 1..5000 (a tap is 2 s), else 1. */
export function sendAmount(kind: LittleThingKind, value: number): number {
  if (kind === 'kiss') return Math.min(KISS_MAX, Math.max(1, Math.round(value)));
  if (kind === 'hug') {
    if (value < HUG_TAP_MS) return HUG_TAP_AMOUNT;
    return Math.min(HUG_MAX_MS, Math.max(1, Math.round(value)));
  }
  return 1;
}

/** `LITTLE_THING_LIMIT` details `{"kind":"kiss","more_with_premium":true}` (string or object). */
export function limitDetailsFrom(
  details: unknown,
): { kind: LittleThingKind; morePremium: boolean } | undefined {
  let value: unknown = details;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (!isLittleThingKind(v.kind)) return undefined;
  return { kind: v.kind, morePremium: v.more_with_premium === true };
}

/* ---------- Receiving (MOB-59, screen 24d) ---------- */

/** A row of `little_things` (CONTRACTS §2), read for the 24d moment. Never holds typed text. */
export type ReceivedRow = {
  id: string;
  senderId: string;
  kind: LittleThingKind;
  /** kiss: kisses in the send; hug: hold in ms; others 1. */
  amount: number;
  /** A hug sent within 10 s after the other's hug (decided by the server). */
  sameTime: boolean;
  createdAt: string;
};

/** Gestures older than this are not acted out when Today opens (a push tapped hours later still is). */
export const RECEIVE_WINDOW_MS = 12 * 60 * 60 * 1000;
/** The partner's gesture "answers" mine when it is the same kind within this time after it. */
export const BACK_WITHIN_MS = 10 * 60 * 1000;
/** The 24d bubble stays this long (longer with a screen reader: until Reply or leaving Today). */
export const BUBBLE_MS = 12_000;

/** What 24d shows: the partner's gestures since the last moment, newest one acted out. */
export type Moment = {
  /** Ids of the gestures in this moment (an undo of all of them clears it). */
  ids: string[];
  /** created_at of the newest one: stored as "seen" once shown. */
  newestAt: string;
  /** The newest gesture: its pose, sound and haptic, and what Reply sends back. */
  kind: LittleThingKind;
  amount: number;
  /** "You hugged at the same time". */
  sameTime: boolean;
  /** Same kind as one I sent shortly before: "Sam kissed you back". */
  back: boolean;
  /** Kisses per kiss, other kinds per send (like the push's `gestures`), in first-sent order. */
  counts: { kind: LittleThingKind; count: number }[];
};

function timeOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The 24d moment from recent rows of the couple: the partner's gestures newer than `seenAt` (and
 * than the receive window), or null. Rows come from the database (RLS: my couple only, undone ones
 * filtered by the query); `me` decides whose rows are the partner's.
 */
export function receivedMoment(
  rows: readonly ReceivedRow[],
  me: string,
  seenAt: string | null,
  now: number,
): Moment | null {
  const since = Math.max(seenAt ? timeOf(seenAt) : 0, now - RECEIVE_WINDOW_MS);
  const unseen = rows
    .filter((r) => r.senderId !== me && timeOf(r.createdAt) > since)
    .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
  const newest = unseen[unseen.length - 1];
  if (!newest) return null;
  const at = timeOf(newest.createdAt);
  const back = rows.some(
    (r) =>
      r.senderId === me &&
      r.kind === newest.kind &&
      timeOf(r.createdAt) < at &&
      at - timeOf(r.createdAt) <= BACK_WITHIN_MS,
  );
  const counts: Moment['counts'] = [];
  for (const r of unseen) {
    const add = r.kind === 'kiss' ? Math.max(1, r.amount) : 1;
    const entry = counts.find((c) => c.kind === r.kind);
    if (entry) entry.count += add;
    else counts.push({ kind: r.kind, count: add });
  }
  return {
    ids: unseen.map((r) => r.id),
    newestAt: newest.createdAt,
    kind: newest.kind,
    amount: newest.amount,
    sameTime: newest.kind === 'hug' && newest.sameTime,
    back,
    counts,
  };
}

/** Whole seconds of a hug for the copy ("a 3-second hug"), at least 1. */
export function hugSeconds(amountMs: number): number {
  return Math.max(1, Math.round(amountMs / 1000));
}
