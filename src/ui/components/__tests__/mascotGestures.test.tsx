import { screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import type * as ReanimatedModule from 'react-native-reanimated';

import { renderUi } from '@/test/render';
import { colors } from '../../theme';
import {
  GESTURE_KINDS,
  gestureDurationMs,
  Mascot,
  type GestureKind,
  type MascotGesture,
} from '../Mascot';
import { sampleMotion } from '../mascot/motion';
import { stillTransform } from '../mascot/rig';

// The Jest stand-in for Reanimated with its builders recorded (as in mascot.test.tsx): what is
// scheduled here is what plays on the UI thread on a device.
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

const hostType = (node: unknown) => (node as { type: string }).type;
const argb = (hex: string) => (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0;

/**
 * What the rig scheduled: every layer's `withTiming(1, …)` (its duration), how many of them play
 * once (not wrapped in `withRepeat`: the rig wraps exactly one timing per repeat) and the counts
 * of the finite repeats (kisses).
 */
function scheduled() {
  const durations = timing.mock.calls.map(([, cfg]) => (cfg as { duration: number }).duration);
  const counts = repeat.mock.calls.map(([, n]) => n);
  return {
    durations,
    once: durations.length - counts.length,
    finite: counts.filter((n) => n !== -1),
  };
}

type Json = { type?: string; props?: Record<string, unknown>; children?: Json[] | null };

/** sin(rotation) of every rotated SVG group (react-native-svg turns transforms into matrices). */
function tilts(tree: unknown): number[] {
  const out: number[] = [];
  const walk = (n: Json | null | undefined) => {
    if (!n || typeof n !== 'object') return;
    const m = n.props?.matrix as number[] | undefined;
    if (m && Math.abs(m[1] ?? 0) > 0.01) out.push(m[1] ?? 0);
    n.children?.forEach(walk);
  };
  walk(tree as Json);
  return out;
}

/** The biggest tilt: the actor's. */
const actorTilt = (tree: unknown) =>
  tilts(tree).reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);

const gesture = (kind: GestureKind, amount = 1, actor: 'you' | 'partner' = 'partner') =>
  ({ kind, amount, actor, id: `${kind}-1` }) satisfies MascotGesture;

beforeEach(() => {
  repeat.mockClear();
  timing.mockClear();
  delay.mockClear();
});

describe('Bao and Bun little-things moments (MOB-66, D48)', () => {
  it.each(GESTURE_KINDS)(
    '%s plays its moment on the UI thread, decorative, under the mood label',
    async (kind) => {
      await renderUi(
        <Mascot
          mood="together"
          partnerName="Sam"
          size={170}
          gesture={gesture(kind)}
          gestureTestID="pose"
          testID="m"
        />,
      );
      const root = screen.getByTestId('m');
      // Animated rig: a View of layers, still one image with the state's label.
      expect(hostType(root)).toBe('View');
      expect(root.props.accessibilityRole).toBe('image');
      expect(root.props.accessibilityLabel).toMatch(/^Bao and Bun, together\./);
      // The moment's marker is hidden from screen readers.
      expect(screen.getByTestId('pose', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByTestId('pose')).toBeNull();
      // One-shot motions on top of the endless loops (breathing, steam, stars).
      expect(scheduled().once).toBeGreaterThan(0);
    },
  );

  it('a hug lasts as long as it was held (1.6 s at least, 5 s at most)', async () => {
    await renderUi(<Mascot mood="together" gesture={gesture('hug', 4200)} />);
    expect(scheduled().durations).toContain(4200);
    expect(gestureDurationMs('hug', 300)).toBe(1600);
    expect(gestureDurationMs('hug', 4200)).toBe(4200);
    expect(gestureDurationMs('hug', 9000)).toBe(5000);
  });

  it('kisses repeat once per kiss (up to 5), 0.9 s each', async () => {
    await renderUi(<Mascot mood="together" gesture={gesture('kiss', 3)} />);
    const { durations, finite } = scheduled();
    expect(durations).toContain(900);
    expect(finite.length).toBeGreaterThan(0);
    expect(new Set(finite)).toEqual(new Set([3]));
    expect(gestureDurationMs('kiss', 3)).toBe(3 * 900 + 480);
    expect(gestureDurationMs('kiss', 9)).toBe(5 * 900 + 480);
  });

  it('goodnight turns the sky night; good morning lifts the lid in a morning sky', async () => {
    const night = await renderUi(<Mascot mood="together" gesture={gesture('goodnight')} />);
    expect(JSON.stringify(night.toJSON())).toContain(String(argb(colors.dark.partnerTint)));
    await night.unmount();
    const morning = await renderUi(<Mascot mood="together" gesture={gesture('good_morning')} />);
    const tree = JSON.stringify(morning.toJSON());
    expect(tree).toContain(String(argb(colors.light.youTint)));
    expect(tree).toContain(String(argb(colors.light.doughLine)));
  });

  it('Reduce Motion: the final still pose, faded in; no motion scheduled', async () => {
    await renderUi(
      <Mascot mood="together" gesture={gesture('hug', 3000)} gestureTestID="pose" testID="m" />,
      { reducedMotion: true },
    );
    expect(hostType(screen.getByTestId('m'))).toBe('RNSVGSvgView');
    expect(screen.getByTestId('pose', { includeHiddenElements: true })).toBeTruthy();
    expect(repeat).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
    // Only the 300 ms fade.
    expect(timing.mock.calls.map(([, cfg]) => (cfg as { duration: number }).duration)).toEqual([
      300,
    ]);
  });

  it('the still pose is the end of the squeeze: Bun (the partner) leans into Bao', async () => {
    const { toJSON } = await renderUi(<Mascot mood="together" gesture={gesture('hug', 3000)} />, {
      reducedMotion: true,
    });
    // Actor Bun tilted -4° towards Bao, Bao +4° towards Bun (sin 4° ≈ 0.07, times the squeeze).
    const t = tilts(toJSON());
    expect(t).toHaveLength(2);
    expect(t[0]).toBeCloseTo(0.074, 2);
    expect(t[1]).toBeCloseTo(-0.074, 2);
  });

  it('who acts follows the viewer: my kiss is Bao hopping right, theirs Bun hopping left', async () => {
    const mine = await renderUi(<Mascot mood="together" gesture={gesture('kiss', 1, 'you')} />, {
      reducedMotion: true,
    });
    // The peck: the actor tilts 14° towards the other (sin 14° ≈ 0.24).
    expect(actorTilt(mine.toJSON())).toBeGreaterThan(0.2);
    await mine.unmount();
    const theirs = await renderUi(<Mascot mood="together" gesture={gesture('kiss', 1)} />, {
      reducedMotion: true,
    });
    expect(actorTilt(theirs.toJSON())).toBeLessThan(-0.2);
  });

  it('is ignored below the face size (no moment on 24-36 pt icons)', async () => {
    await renderUi(
      <Mascot mood="together" size={36} gesture={gesture('kiss')} gestureTestID="pose" />,
    );
    expect(screen.queryByTestId('pose', { includeHiddenElements: true })).toBeNull();
  });

  it('without a gesture the mood plays as before', async () => {
    await renderUi(<Mascot mood="together" gesture={null} gestureTestID="pose" />);
    expect(screen.queryByTestId('pose', { includeHiddenElements: true })).toBeNull();
    expect(scheduled().once).toBe(0);
  });
});

describe('rig helpers', () => {
  it('stillTransform matches the view transform order, around the origin', () => {
    expect(stillTransform({ tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, op: 1 })).toBeUndefined();
    expect(stillTransform({ tx: 2, ty: -3, sx: 1.5, sy: 0.5, rot: 10, op: 1 }, [10, 20])).toBe(
      'translate(12 17) rotate(10) scale(1.5 0.5) translate(-10 -20)',
    );
  });

  it('squish overshoots its target mid-way (DESIGN.md §6)', () => {
    const k = { at: [0, 1], tx: [0, 10] };
    const values = [0.5, 0.6, 0.7, 0.8].map((p) => sampleMotion(k, 'squish', p).tx);
    expect(Math.max(...values)).toBeGreaterThan(10);
    expect(sampleMotion(k, 'squish', 1).tx).toBe(10);
    expect(sampleMotion(k, 'standard', 0.5).tx).toBeGreaterThan(5);
  });
});
