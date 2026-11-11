import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import type * as ReanimatedModule from 'react-native-reanimated';

import { renderUi } from '@/test/render';
import { colors } from '../../theme';
import { ReducedMotionOverride } from '../../useReducedMotion';
import { Mascot, MASCOT_MIN_SIZE, mascotMoods } from '../Mascot';

type Node = { props: Record<string, unknown> };

// The Jest stand-in for Reanimated (src/test/reanimated-mock.tsx), with its animation builders
// recorded: which loops a mood schedules is what plays on the UI thread on a device.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof ReanimatedModule>('react-native-reanimated');
  return {
    ...actual,
    __esModule: true,
    withRepeat: jest.fn(actual.withRepeat),
    withTiming: jest.fn(actual.withTiming),
    withDelay: jest.fn(actual.withDelay),
    cancelAnimation: jest.fn(),
  };
});
const repeat = jest.mocked(Reanimated.withRepeat);
const timing = jest.mocked(Reanimated.withTiming);
const delay = jest.mocked(Reanimated.withDelay);

/** The host component of a rendered node ('View' for the animated rig, 'RNSVGSvgView' still). */
const hostType = (node: unknown) => (node as { type: string }).type;

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

  it('Reduce Motion shows the still pose: one Svg, nothing scheduled (MOB-31)', async () => {
    const a = await renderUi(<Mascot mood="celebrating" still testID="m" />);
    const still = JSON.stringify(a.toJSON());
    await a.unmount();
    repeat.mockClear();
    const b = await renderUi(<Mascot mood="celebrating" testID="m" />, { reducedMotion: true });
    expect(JSON.stringify(b.toJSON())).toBe(still);
    expect(hostType(screen.getByTestId('m'))).toBe('RNSVGSvgView');
    expect(repeat).not.toHaveBeenCalled();
  });

  it('switches to the still pose when Reduce Motion turns on while shown', async () => {
    const { rerender } = await renderUi(<Mascot mood="together" testID="m" />);
    expect(hostType(screen.getByTestId('m'))).toBe('View');
    await rerender(
      <ReducedMotionOverride value>
        <Mascot mood="together" testID="m" />
      </ReducedMotionOverride>,
    );
    expect(hostType(screen.getByTestId('m'))).toBe('RNSVGSvgView');
    expect(screen.getByLabelText('Bao and Bun, together. You both answered today.')).toBeTruthy();
  });
});

describe('Mascot animation (MOB-31, D32)', () => {
  // Moving layers per mood, from the board: [motion, loop ms, delay ms].
  const LOOPS: Record<string, [string, number, number][]> = {
    together: [
      ['steam', 2800, 0],
      ['steam', 2800, 1200],
      ['breathe', 2600, 400],
      ['blink', 4200, 1300],
      ['breathe', 2600, 0],
      ['blink', 4200, 0],
    ],
    celebrating: [
      ['confetti', 1800, 0],
      ['confetti', 1800, 500],
      ['confetti', 1800, 1000],
      ['confetti', 1800, 300],
      ['heartHop', 2400, 0],
      ['bounce', 1600, 800],
      ['bounce', 1600, 0],
    ],
    waiting: [
      ['steam', 2800, 0],
      ['sleepyBreathe', 4000, 0],
      ['wobble', 2000, 0],
      ['breathe', 2600, 0],
      ['blink', 4200, 0],
    ],
    snuggled: [
      ['heartHop', 2400, 0],
      ['breathe', 2600, 400],
      ['blink', 4200, 1300],
      ['breathe', 2600, 0],
      ['blink', 4200, 0],
    ],
    'saving-a-seat': [
      ['steam', 2800, 0],
      ['wobble', 2000, 0],
      ['breathe', 2600, 0],
      ['blink', 4200, 0],
    ],
    napping: [
      ['snore', 3000, 0],
      ['snore', 3000, 1000],
      ['snore', 3000, 2000],
    ],
  };

  /** Each scheduled loop as "duration+delay", sorted (effects run children first). */
  const loops = () =>
    timing.mock.calls
      .map((c, i) => `${(c[1] as { duration: number }).duration}+${delay.mock.calls[i]?.[0]}`)
      .sort();

  beforeEach(() => {
    repeat.mockClear();
    timing.mockClear();
    delay.mockClear();
  });

  it.each(mascotMoods)('%s loops its board motions on the UI thread', async (mood) => {
    await renderUi(<Mascot mood={mood} partnerName="Sam" testID="m" />);
    const root = screen.getByTestId('m');
    expect(hostType(root)).toBe('View');
    expect((root as unknown as Node).props.accessibilityRole).toBe('image');
    const expected = LOOPS[mood] ?? [];
    // One infinite, non-reversing loop per moving layer, driven by a linear 0 → 1 timing.
    expect(repeat).toHaveBeenCalledTimes(expected.length);
    for (const call of repeat.mock.calls) expect(call.slice(1)).toEqual([-1, false]);
    expect(loops()).toEqual(expected.map(([, ms, d]) => `${ms}+${d}`).sort());
    expect(timing.mock.calls.every((c) => c[0] === 1)).toBe(true);
  });

  it('the awake one is the one that moves (waiting, partner awake)', async () => {
    await renderUi(<Mascot mood="waiting" awake="partner" partnerName="Sam" />);
    // Bun (partner) sways, breathes and blinks; Bao sleeps with the slow breath; steam over Bun.
    expect(loops()).toEqual(['2000+0', '2600+0', '2800+0', '4000+0', '4200+0']);
  });

  it('a mascot as one image: the moving layers are not accessible and take no touches', async () => {
    await renderUi(<Mascot mood="together" testID="m" />);
    const root = screen.getByTestId('m') as unknown as {
      children: { props: Record<string, unknown> }[];
    };
    expect(root.children.length).toBeGreaterThan(1);
    for (const layer of root.children) {
      expect(layer.props.pointerEvents).toBe('none');
      expect(layer.props.accessible).toBeUndefined();
    }
  });

  it('stays still below the face size and with `still`', async () => {
    await renderUi(
      <>
        <Mascot mood="together" size={36} testID="small" />
        <Mascot mood="together" size={40} still testID="icon" />
      </>,
    );
    expect(hostType(screen.getByTestId('small'))).toBe('RNSVGSvgView');
    expect(hostType(screen.getByTestId('icon'))).toBe('RNSVGSvgView');
    expect(repeat).not.toHaveBeenCalled();
  });

  it('stops its loops when it leaves the screen', async () => {
    const cancel = jest.mocked(Reanimated.cancelAnimation);
    cancel.mockClear();
    const { unmount } = await renderUi(<Mascot mood="napping" />);
    await unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it('scales the motion with the size and starts at the 0 % frame', async () => {
    await renderUi(<Mascot mood="napping" size={240} testID="m" />);
    const root = screen.getByTestId('m') as unknown as {
      children: { props: { style: Record<string, unknown>[] } }[];
    };
    const style = StyleSheet.flatten(root.children[0]?.props.style) as {
      opacity: number;
      width: number;
      transform: Record<string, number>[];
    };
    expect(style.width).toBe(240);
    expect(style.opacity).toBe(0);
    expect(style.transform).toContainEqual({ translateY: 12 }); // 6 canvas units × 2
  });
});
