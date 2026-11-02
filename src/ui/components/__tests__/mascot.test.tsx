import { screen } from '@testing-library/react-native';

import { renderUi } from '@/test/render';
import { colors } from '../../theme';
import { Mascot, MASCOT_MIN_SIZE, mascotMoods } from '../Mascot';

type Node = { props: Record<string, unknown> };

/** react-native-svg turns '#RRGGBB' into an opaque ARGB integer before it reaches the native view. */
const argb = (hex: string) => (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0;

/** Every fill/stroke colour (as ARGB) on the rendered SVG tree. */
function paints(root: unknown): number[] {
  const out: number[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as { props?: Record<string, unknown>; children?: unknown[] };
    for (const key of ['fill', 'stroke'] as const) {
      const v = node.props?.[key] as { payload?: number } | null | undefined;
      if (typeof v?.payload === 'number') out.push(v.payload);
    }
    node.children?.forEach(walk);
  };
  walk(root);
  return out;
}

describe('Mascot', () => {
  it.each(mascotMoods)('%s is one image with a state label', async (mood) => {
    await renderUi(<Mascot mood={mood} partnerName="Sam" testID="m" />);
    const node = screen.getByTestId('m') as unknown as Node;
    expect(node.props.accessibilityRole).toBe('image');
    expect(String(node.props.accessibilityLabel)).toMatch(/Bao/);
  });

  it('describes who is waiting, using the partner name', async () => {
    await renderUi(
      <>
        <Mascot mood="waiting" partnerName="Sam" />
        <Mascot mood="waiting" awake="partner" partnerName="Sam" />
      </>,
    );
    expect(screen.getByLabelText("Bao and Bun, waiting. Sam hasn't answered yet.")).toBeTruthy();
    expect(
      screen.getByLabelText('Bao and Bun, waiting. Sam has answered and is waiting for you.'),
    ).toBeTruthy();
  });

  it('falls back to a neutral partner label and honours an override', async () => {
    await renderUi(
      <>
        <Mascot mood="saving-a-seat" />
        <Mascot mood="together" accessibilityLabel="Custom" />
      </>,
    );
    expect(
      screen.getByLabelText("Bao is saving a seat. Your partner hasn't joined yet."),
    ).toBeTruthy();
    expect(screen.getByLabelText('Custom')).toBeTruthy();
  });

  it('never goes below the minimum size', async () => {
    await renderUi(<Mascot mood="together" size={10} testID="m" />);
    expect((screen.getByTestId('m') as unknown as Node).props.width).toBe(MASCOT_MIN_SIZE);
  });

  it('drops the face under 40 but keeps the blush dots', async () => {
    const { toJSON, unmount } = await renderUi(<Mascot mood="together" size={64} />);
    const big = JSON.stringify(toJSON());
    await unmount();
    const small = await renderUi(<Mascot mood="together" size={32} />);
    const smallTree = JSON.stringify(small.toJSON());
    expect(big.length).toBeGreaterThan(smallTree.length);
    expect(smallTree).toContain(String(argb(colors.light.you)));
    expect(smallTree).toContain(String(argb(colors.light.partner)));
    expect(smallTree).not.toContain('"cx":31');
  });

  it('Bao is orange and Bun sky, from the active scheme', async () => {
    const light = await renderUi(<Mascot mood="snuggled" />);
    const lightPaints = paints(light.toJSON());
    await light.unmount();
    expect(lightPaints).toContain(argb(colors.light.you));
    expect(lightPaints).toContain(argb(colors.light.partner));

    const dark = await renderUi(<Mascot mood="snuggled" />, { scheme: 'dark' });
    expect(paints(dark.toJSON())).toContain(argb(colors.dark.bamboo));
  });

  it('is the same still pose with reduced motion', async () => {
    const a = await renderUi(<Mascot mood="celebrating" />);
    const plain = JSON.stringify(a.toJSON());
    await a.unmount();
    const b = await renderUi(<Mascot mood="celebrating" />, { reducedMotion: true });
    expect(JSON.stringify(b.toJSON())).toBe(plain);
  });
});
