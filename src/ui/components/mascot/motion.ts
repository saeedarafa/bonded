import { motion as tokens } from '../../theme';

/**
 * Keyframe motions for Bao and Bun (D32, MOB-31). The numbers are the mascot's CSS keyframes in
 * `design-handoff/Couples App — Full Flow.html` ("Dim and Sum mascot" board: `dmbr`, `dmbl`,
 * `dmsm`, `dmbo`, `dmhp`, `dmwb`, `dmzz`, `dmcf`), re-expressed for Reanimated. Every value is
 * read on the UI thread by `sampleMotion` (a worklet): one shared value per layer goes 0 → 1 in a
 * repeat loop, nothing runs on the JS thread while a mood plays.
 *
 * Units: translations are in the mascot's 120 × 120 canvas units (the rig multiplies by
 * size / 120); a motion that the board applies inside a dumpling (`scale(0.62)`) is already
 * scaled here. Rotation in degrees.
 */

/**
 * CSS timing functions; `standard` and `squish` are DESIGN.md §6 (`--std`, `--squish` in
 * `little-things.html`). Squish overshoots (y > 1): a pose goes a little past its target.
 */
export type Ease = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | 'standard' | 'squish';

/** Values per keyframe stop; every array has the same length as `at`. Missing = identity. */
export type Keyframes = {
  /** Stops in 0..1, ascending, first 0 and last 1. */
  at: readonly number[];
  tx?: readonly number[];
  ty?: readonly number[];
  sx?: readonly number[];
  sy?: readonly number[];
  rot?: readonly number[];
  op?: readonly number[];
};

export type Motion = {
  keyframes: Keyframes;
  /** One loop, ms. */
  duration: number;
  /** Before the first loop (CSS `animation-delay`), ms. The layer holds the 0 % frame meanwhile. */
  delay?: number;
  /** Timing function per segment, as in CSS. */
  ease: Ease;
  /**
   * CSS `animation-iteration-count`. Default: forever (the moods). A finite count is a one-shot
   * moment (MOB-66 gestures) that holds its last frame afterwards (`animation-fill-mode: both`).
   */
  iterations?: number;
};

/** Transform origin and the pose shown when nothing moves (Reduce Motion, small sizes). */
export type Pose = { tx: number; ty: number; sx: number; sy: number; rot: number; op: number };

export const REST: Pose = { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, op: 1 };

function bezier(v: readonly number[]): readonly [number, number, number, number] {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 1, v[3] ?? 1];
}

const BEZIER: Record<Exclude<Ease, 'linear'>, readonly [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  standard: bezier(tokens.easing.standard),
  squish: bezier(tokens.easing.squish),
};

/** CSS `cubic-bezier(x1, y1, x2, y2)` at time x (0..1). Newton steps, then bisection. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = ((ax * t + bx) * t + cx) * t - x;
    if (Math.abs(err) < 1e-6) return ((ay * t + by) * t + cy) * t;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 30; i++) {
    const v = ((ax * t + bx) * t + cx) * t;
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

export function applyEase(ease: Ease, t: number): number {
  'worklet';
  if (ease === 'linear') return t;
  const b = BEZIER[ease];
  return cubicBezier(b[0], b[1], b[2], b[3], t);
}

function track(
  values: readonly number[] | undefined,
  fallback: number,
  i: number,
  e: number,
): number {
  'worklet';
  if (!values) return fallback;
  const from = values[i] ?? fallback;
  return from + ((values[i + 1] ?? from) - from) * e;
}

/** The pose at progress p (0..1) of one loop. */
export function sampleMotion(keyframes: Keyframes, ease: Ease, p: number): Pose {
  'worklet';
  const at = keyframes.at;
  const clamped = p <= 0 ? 0 : p >= 1 ? 1 : p;
  let i = 0;
  while (i < at.length - 2 && clamped > (at[i + 1] ?? 1)) i++;
  const start = at[i] ?? 0;
  const span = (at[i + 1] ?? 1) - start;
  const e = applyEase(ease, span > 0 ? (clamped - start) / span : 1);
  return {
    tx: track(keyframes.tx, 0, i, e),
    ty: track(keyframes.ty, 0, i, e),
    sx: track(keyframes.sx, 1, i, e),
    sy: track(keyframes.sy, 1, i, e),
    rot: track(keyframes.rot, 0, i, e),
    op: track(keyframes.op, 1, i, e),
  };
}

/** Dumpling art sits in `translate(x 57) scale(0.62)` on the canvas. */
export const DUMPLING_SCALE = 0.62;
const D = DUMPLING_SCALE;

/** The board's motions. `delay` is set per use (the two dumplings never move in lockstep). */
export const MOTIONS = {
  /** `dmbr`: a slow squash-and-stretch from the base, 2.6 s. */
  breathe: {
    keyframes: { at: [0, 0.5, 1], sx: [1, 1.04, 1], sy: [1, 0.95, 1] },
    duration: 2600,
    ease: 'easeInOut',
  },
  /** `dmbr` at 4 s: the one who is still asleep (waiting). */
  sleepyBreathe: {
    keyframes: { at: [0, 0.5, 1], sx: [1, 1.04, 1], sy: [1, 0.95, 1] },
    duration: 4000,
    ease: 'easeInOut',
  },
  /** `dmbl`: eyes close for a moment every 4.2 s. */
  blink: {
    keyframes: { at: [0, 0.9, 0.94, 1], sy: [1, 1, 0.1, 1] },
    duration: 4200,
    ease: 'ease',
  },
  /** `dmsm`: a curl of steam rises and fades, 2.8 s. */
  steam: {
    keyframes: { at: [0, 0.3, 1], ty: [6, 1.2, -10], op: [0, 0.9, 0] },
    duration: 2800,
    ease: 'easeIn',
  },
  /** `dmbo`: a happy bounce from the base, 1.6 s (inside the dumpling: × 0.62). */
  bounce: {
    keyframes: {
      at: [0, 0.15, 0.45, 0.7, 1],
      ty: [0, 0, -10 * D, 0, 0],
      sx: [1, 1.08, 0.96, 1.05, 1],
      sy: [1, 0.9, 1.05, 0.94, 1],
    },
    duration: 1600,
    ease: 'easeInOut',
  },
  /** `dmhp`: the heart pops in, floats up and fades, 2.4 s. */
  heartHop: {
    keyframes: {
      at: [0, 0.25, 0.6, 1],
      ty: [6, 0, -6, -14],
      sx: [0, 1.2, 1, 1],
      sy: [0, 1.2, 1, 1],
      op: [0, 1, 1, 0],
    },
    duration: 2400,
    ease: 'easeOut',
  },
  /** `dmwb`: a little side-to-side sway from the base, 2 s. */
  wobble: {
    keyframes: { at: [0, 0.5, 1], rot: [-3, 3, -3] },
    duration: 2000,
    ease: 'easeInOut',
  },
  /** `dmzz`: a "z" drifts up and right, 3 s. */
  snore: {
    keyframes: { at: [0, 0.3, 1], tx: [0, 2.4, 8], ty: [6, -1.2, -18], op: [0, 1, 0] },
    duration: 3000,
    ease: 'easeInOut',
  },
  /** `dmcf`: a sesame seed falls, 1.8 s. */
  confetti: {
    keyframes: { at: [0, 0.15, 1], ty: [-10, 0.5, 60], op: [0, 1, 0] },
    duration: 1800,
    ease: 'linear',
  },
} as const satisfies Record<string, Motion>;

export type MotionName = keyof typeof MOTIONS;

export function motion(name: MotionName, delay = 0): Motion {
  return { ...MOTIONS[name], delay };
}
