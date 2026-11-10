import {
  EMOJI_CATEGORIES,
  emojiId,
  emojiInCategory,
  emojiName,
  isHeart,
  myReaction,
  nextReaction,
  normalizeReaction,
  QUICK_REACTIONS,
  reactionCounts,
  searchEmoji,
} from '@/ui/emoji';

const HEART = '❤️';
const BARE_HEART = '❤';

describe('emoji (D45)', () => {
  it('quick row is the board order, fully qualified', () => {
    expect(QUICK_REACTIONS).toEqual([HEART, '😂', '😮', '🥹', '🔥']);
  });

  it('names come from CLDR, for screen readers', () => {
    expect(emojiName(HEART)).toBe('red heart');
    expect(emojiName(BARE_HEART)).toBe('red heart');
    expect(emojiName('😂')).toBe('face with tears of joy');
    expect(emojiName('🥹')).toBe('face holding back tears');
    expect(emojiName('👍🏽')).toBe('thumbs up: medium skin tone');
    expect(emojiName('🏴󠁧󠁢󠁳󠁣󠁴󠁿')).toBe('flag: Scotland');
    // Unknown: the emoji itself (screen readers still speak it).
    expect(emojiName('x')).toBe('x');
  });

  it('a bare heart is the stored ❤️ (the database stores U+2764 U+FE0F)', () => {
    expect(normalizeReaction(BARE_HEART)).toBe(HEART);
    expect(normalizeReaction(HEART)).toBe(HEART);
    expect(isHeart(BARE_HEART)).toBe(true);
    expect(isHeart(HEART)).toBe(true);
    expect(isHeart('❤️‍🔥')).toBe(false);
    expect(isHeart('🔥')).toBe(false);
  });

  it('ids are code points without U+FE0F', () => {
    expect(emojiId(HEART)).toBe('2764');
    expect(emojiId('😂')).toBe('1F602');
    expect(emojiId('👨‍👩‍👧')).toBe('1F468-200D-1F469-200D-1F467');
  });

  it('the picker offers every category, no skin-tone components, nothing newer than Emoji 14', () => {
    for (const c of EMOJI_CATEGORIES) expect(emojiInCategory(c).length).toBeGreaterThan(0);
    const all = EMOJI_CATEGORIES.flatMap((c) => emojiInCategory(c).map((e) => e.emoji));
    expect(all).toContain('🥹'); // 14.0
    expect(all).toContain('🇯🇵');
    expect(all).not.toContain('🏻'); // component
    expect(all).not.toContain('🇦'); // lone regional indicator
    expect(all).not.toContain('🫨'); // 15.0 shaking face
    expect(new Set(all).size).toBe(all.length);
    for (const q of QUICK_REACTIONS) expect(all).toContain(q);
  });

  it('search is offline over names and keywords, best matches first', () => {
    expect(searchEmoji('')).toEqual([]);
    expect(searchEmoji('  ')).toEqual([]);
    const heart = searchEmoji('heart').map((e) => e.emoji);
    expect(heart).toContain(HEART);
    expect(searchEmoji('Pizza')[0]?.emoji).toBe('🍕');
    expect(searchEmoji('zzzzqq')).toEqual([]);
  });

  it('counts per emoji, mine marked, quick row first', () => {
    const counts = reactionCounts(
      [
        { userId: 'me', kind: BARE_HEART },
        { userId: 'them', kind: HEART },
        { userId: 'x', kind: '🐙' },
      ],
      'me',
      { includeQuick: true },
    );
    expect(counts.map((c) => c.kind)).toEqual([...QUICK_REACTIONS, '🐙']);
    expect(counts[0]).toEqual({ kind: HEART, count: 2, mine: true });
    expect(counts[5]).toEqual({ kind: '🐙', count: 1, mine: false });
    expect(reactionCounts([], 'me', { includeQuick: false })).toEqual([]);
  });

  it('one per person: another replaces, the same removes', () => {
    expect(myReaction([{ userId: 'me', kind: BARE_HEART }], 'me')).toBe(HEART);
    expect(myReaction([{ userId: 'them', kind: HEART }], 'me')).toBeNull();
    expect(nextReaction(null, '😂')).toBe('😂');
    expect(nextReaction('😂', '🔥')).toBe('🔥');
    expect(nextReaction('😂', '😂')).toBeNull();
    expect(nextReaction(HEART, BARE_HEART)).toBeNull();
  });
});
