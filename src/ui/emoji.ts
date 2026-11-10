import compact from 'emojibase-data/en/compact.json';
import versions from 'emojibase-data/versions/emoji.json';

/**
 * D45 (BE-40): a reaction is exactly one system emoji, stored as `reactions.kind`. The database
 * validates it (`INVALID_REACTION`); this module only offers emoji the database accepts and names
 * them for screen readers. Data: `emojibase-data` (CLDR names, offline, bundled; no network).
 */

/** Board 21 / DS-Components quick row, in this order. */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '🥹', '🔥'] as const;

/**
 * Newest Emoji version offered in the picker. Newer emoji show as empty boxes on phones whose
 * system font predates them (Emoji 14.0: iOS 15.4, Android 12L), and the partner's phone may be
 * older than mine. Reactions with newer emoji (none from this app) still display and count.
 */
export const MAX_EMOJI_VERSION = 14;

const VS16 = /\uFE0F/g;

/** The fields of emojibase's compact dataset this module reads. */
type CompactEmoji = {
  unicode: string;
  hexcode: string;
  label: string;
  group?: number;
  order?: number;
  tags?: string[];
  skins?: { unicode: string; label: string }[];
};

/** Key that ignores the emoji variation selector (`❤` and `❤️` are one reaction). */
function bare(emoji: string): string {
  return emoji.replace(VS16, '');
}

export type EmojiItem = { emoji: string; label: string; tags: readonly string[] };

export type EmojiCategory =
  | 'smileys'
  | 'people'
  | 'animals'
  | 'food'
  | 'travel'
  | 'activities'
  | 'objects'
  | 'symbols'
  | 'flags';

/** emojibase group number -> our category (group 2, skin tone components, is never offered). */
const GROUPS: Record<number, EmojiCategory> = {
  0: 'smileys',
  1: 'people',
  3: 'animals',
  4: 'food',
  5: 'travel',
  6: 'activities',
  7: 'objects',
  8: 'symbols',
  9: 'flags',
};

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  'smileys',
  'people',
  'animals',
  'food',
  'travel',
  'activities',
  'objects',
  'symbols',
  'flags',
];

type Catalog = {
  sections: Record<EmojiCategory, EmojiItem[]>;
  /** Every known emoji (skin tones too) by `bare()` key: its fully-qualified form and name. */
  byKey: Map<string, { emoji: string; label: string }>;
  all: EmojiItem[];
};

let catalog: Catalog | null = null;

/** Built once, on first use (the picker or a label), not at app start. */
function getCatalog(): Catalog {
  if (catalog) return catalog;
  const tooNew = new Set<string>();
  for (const [version, hexcodes] of Object.entries(versions as Record<string, string[]>)) {
    if (Number(version) > MAX_EMOJI_VERSION) hexcodes.forEach((h) => tooNew.add(h));
  }
  const sections = Object.fromEntries(
    EMOJI_CATEGORIES.map((c) => [c, [] as EmojiItem[]]),
  ) as Record<EmojiCategory, EmojiItem[]>;
  const byKey = new Map<string, { emoji: string; label: string }>();
  const all: EmojiItem[] = [];
  const rows = [...(compact as unknown as CompactEmoji[])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const e of rows) {
    byKey.set(bare(e.unicode), { emoji: e.unicode, label: e.label });
    for (const s of e.skins ?? []) byKey.set(bare(s.unicode), { emoji: s.unicode, label: s.label });
    const category = e.group === undefined ? undefined : GROUPS[e.group];
    if (!category || tooNew.has(e.hexcode)) continue;
    const item = { emoji: e.unicode, label: e.label, tags: e.tags ?? [] };
    sections[category].push(item);
    all.push(item);
  }
  catalog = { sections, byKey, all };
  return catalog;
}

/** The picker's emoji for one category, in Unicode order. */
export function emojiInCategory(category: EmojiCategory): readonly EmojiItem[] {
  return getCatalog().sections[category];
}

/**
 * Offline search over CLDR names and keywords: names that start with the query first, then other
 * matches. Empty query: nothing.
 */
export function searchEmoji(query: string): readonly EmojiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: EmojiItem[] = [];
  const contains: EmojiItem[] = [];
  for (const item of getCatalog().all) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q) || label.includes(` ${q}`)) starts.push(item);
    else if (label.includes(q) || item.tags.some((tag) => tag.startsWith(q))) contains.push(item);
  }
  return [...starts, ...contains];
}

/**
 * The stored form of a reaction: fully qualified (`❤` -> `❤️`, as the database stores it), so
 * counts and "is it mine" compare the same strings. Unknown emoji come back unchanged.
 */
export function normalizeReaction(kind: string): string {
  return getCatalog().byKey.get(bare(kind))?.emoji ?? kind;
}

/** CLDR name for screen readers ("red heart", "face with tears of joy"); the emoji itself if unknown. */
export function emojiName(kind: string): string {
  return getCatalog().byKey.get(bare(kind))?.label ?? kind;
}

/** ❤️ with or without U+FE0F (D45: hearts count as love). */
export function isHeart(kind: string): boolean {
  return bare(kind) === '\u2764';
}

/** Stable, Maestro-friendly id part: code points in hex, without U+FE0F (`❤️` -> `2764`). */
export function emojiId(kind: string): string {
  return [...bare(kind)].map((c) => (c.codePointAt(0) ?? 0).toString(16).toUpperCase()).join('-');
}

export type ReactionCount = { kind: string; count: number; mine: boolean };

/**
 * Pure: counts per emoji (D45) for one answer or message, with mine marked. Quick-row emoji first
 * (in board order, even at 0), then any other emoji in the order they first appear.
 */
export function reactionCounts(
  reactions: readonly { userId: string; kind: string }[],
  userId: string | null | undefined,
  { includeQuick }: { includeQuick: boolean },
): ReactionCount[] {
  const counts = new Map<string, ReactionCount>();
  if (includeQuick) {
    for (const kind of QUICK_REACTIONS) counts.set(kind, { kind, count: 0, mine: false });
  }
  for (const r of reactions) {
    const kind = normalizeReaction(r.kind);
    const entry = counts.get(kind) ?? { kind, count: 0, mine: false };
    entry.count += 1;
    if (userId && r.userId === userId) entry.mine = true;
    counts.set(kind, entry);
  }
  return [...counts.values()];
}

/** My reaction on a target, normalised; null if none. */
export function myReaction(
  reactions: readonly { userId: string; kind: string }[],
  userId: string | null | undefined,
): string | null {
  const mine = reactions.find((r) => !!userId && r.userId === userId);
  return mine ? normalizeReaction(mine.kind) : null;
}

/** One reaction per person (D45): the same emoji again removes it (null), another replaces it. */
export function nextReaction(current: string | null, picked: string): string | null {
  const next = normalizeReaction(picked);
  return current !== null && normalizeReaction(current) === next ? null : next;
}
