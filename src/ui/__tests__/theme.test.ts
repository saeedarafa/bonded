import handoff from '../../../design-handoff/tokens/tokens.json';
import { fontAssets } from '../fonts';
import { colors, fonts, personColors, type } from '../theme';
import tokens from '../tokens.json';

describe('theme tokens', () => {
  it('src/ui/tokens.json matches design-handoff/tokens/tokens.json', () => {
    expect(tokens).toEqual(handoff);
  });

  it('light and dark define the same colour names', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  });

  it('every type token resolves to a loaded font', () => {
    const loaded = Object.keys(fontAssets);
    for (const style of Object.values(type)) {
      expect(loaded).toContain(style.fontFamily);
    }
  });

  it('every font name in `fonts` is loaded', () => {
    const names = [...Object.values(fonts.display), ...Object.values(fonts.body)];
    expect(Object.keys(fontAssets).sort()).toEqual([...names].sort());
  });
});

describe('personColors', () => {
  it.each(['light', 'dark'] as const)('viewer is orange, partner is sky (%s)', (scheme) => {
    const c = colors[scheme];
    expect(personColors(c, true)).toEqual({
      fill: c.you,
      text: c.youText,
      tint: c.youTint,
      on: c.onYou,
    });
    expect(personColors(c, false)).toEqual({
      fill: c.partner,
      text: c.partnerText,
      tint: c.partnerTint,
      on: c.onPartner,
    });
  });
});
