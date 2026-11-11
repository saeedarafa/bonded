import { useMemo, type ReactNode } from 'react';
import { Circle, Path, Rect } from 'react-native-svg';

import { colors as palettes, personColors, type ThemeColors } from '../../theme';
import {
  Basket,
  Dough,
  dumplingBase,
  dumplingFrame,
  Eyes,
  HEART,
  LidArt,
  Mouth,
  Steam,
} from './art';
import { DUMPLING_SCALE, type Ease, type Keyframes, type Motion, type Pose } from './motion';
import { Layer } from './rig';

/**
 * Bao and Bun's little-things moments (D48, D32 as amended; MOB-66): one short scene per gesture,
 * built from `design-handoff/prototypes/little-things.html` (its `stageSVG` and the `p-hug`,
 * `p-kiss`, `p-night`, `p-morning`, `p-miss` keyframes) on the MOB-31 rig.
 *
 * - **Hug:** they lean in and squeeze, the blush deepens, a heart rises (as long as the hug).
 * - **Kiss:** a hop and a peck on the cheek, little hearts pop (once per kiss).
 * - **Goodnight:** the sky turns night, moon and stars, they lean together and fall asleep.
 * - **Good morning:** sunrise, the lid lifts, a blink and a stretch.
 * - **Miss you:** they drift apart, a thread joins them, a heartbeat travels across.
 *
 * Geometry: the prototype stage is 320 × 196 with the dumplings at `translate(78|154 80)
 * scale(1.1)`; the mascot canvas is 120 × 120 with them at `translate(10|56 57) scale(0.62)`. A
 * stage point maps by `stageX`/`stageY` (the basket lands where the mood scenes draw it), a motion
 * inside a dumpling (`.mv`) is scaled by `DUMPLING_SCALE` like MOB-31's. `d` is the prototype's
 * `--d`: +1 when the actor is Bao (the viewer, left), -1 when it is Bun (the partner, right).
 *
 * Every layer plays once (`iterations`) and holds its last frame; the moment lasts
 * `gestureDurationMs`, then the mascot goes back to its mood. With Reduce Motion each layer shows
 * its `rest` pose: the moment's final pose (prototype: "each moment becomes its final still pose").
 * Colours are tokens; the night and morning skies use the fixed scheme a sky has.
 */

export const GESTURE_KINDS = ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'] as const;
export type GestureKind = (typeof GESTURE_KINDS)[number];

/** A moment on the mascot: which gesture, how much (hug ms, kisses), who acts it out. */
export type MascotGesture = {
  kind: GestureKind;
  /** Hug: held ms (1..5000; the moment lasts at least 1.6 s). Kiss: 1..5. Others: 1. */
  amount: number;
  /** `partner` = Bun acts (a received gesture), `you` = Bao (one I sent). */
  actor: 'you' | 'partner';
  /** A new id restarts the moment (the same gesture sent twice). */
  id?: string;
};

/** Stage → canvas: the prototype's dumplings are 1.1 × , the canvas's 0.62 × . */
const K = DUMPLING_SCALE / 1.1;
const stageX = (x: number) => 60 + (x - 160) * K;
const stageY = (y: number) => 57 + (y - 80) * K;
const D = DUMPLING_SCALE;

const BAO_X = 10;
const BUN_X = 56;

const KISS_MS = 900;
const KISS_MAX = 5;
const HUG_MIN_MS = 1600;
const HUG_MAX_MS = 5000;
const NIGHT_MS = 4800;
const MORNING_MS = 3000;
const MISS_MS = 2600;
/** The night and morning skies fade out over the moment's last half second. */
const OUTRO_MS = 500;

/** How long a moment plays before the mascot returns to its mood, ms. */
export function gestureDurationMs(kind: GestureKind, amount: number): number {
  switch (kind) {
    case 'hug':
      return hugMs(amount);
    case 'kiss':
      return kisses(amount) * KISS_MS + 480;
    case 'goodnight':
      return NIGHT_MS;
    case 'good_morning':
      return MORNING_MS;
    case 'miss_you':
      return MISS_MS;
  }
}

function hugMs(amount: number): number {
  return Math.max(HUG_MIN_MS, Math.min(HUG_MAX_MS, amount));
}

function kisses(amount: number): number {
  return Math.max(1, Math.min(KISS_MAX, Math.round(amount)));
}

/** A one-shot motion (CSS `animation: … both`). */
function once(
  keyframes: Keyframes,
  duration: number,
  ease: Ease,
  delay = 0,
  iterations = 1,
): Motion {
  return { keyframes, duration, ease, delay, iterations };
}

/** Holds, then fades out over the last `OUTRO_MS` of a moment of `total` ms. */
function outro(total: number): Motion {
  return once({ at: [0, (total - OUTRO_MS) / total, 1], op: [1, 1, 0] }, total, 'linear');
}

const sx = (v: readonly number[]) => ({ sx: v, sy: v });

type DumplingMotions = {
  /** `.mv`: the whole dumpling, from its base. */
  body?: Motion;
  bodyRest?: Partial<Pose>;
  /** Each blush dot, from its centre. */
  blush?: Motion;
  blushRest?: Partial<Pose>;
  /** Open and closed eyes (goodnight, good morning): opacity only. */
  eyesOpen?: Motion;
  eyesOpenRest?: number;
  eyesClosed?: Motion;
  eyesClosedRest?: number;
};

/** The prototype's `.breath`: a gentler squash than the moods' (1.025 / 0.975), 2.6 s. */
function breath(delay: number): Motion {
  return {
    keyframes: { at: [0, 0.5, 1], sx: [1, 1.025, 1], sy: [1, 0.975, 1] },
    duration: 2600,
    ease: 'easeInOut',
    delay,
  };
}

const CLOSED_EYES = 'M27 40 Q31 43 35 40 M45 40 Q49 43 53 40';

function GestureDumpling({
  x,
  blush,
  breathDelay,
  m,
  colors,
}: {
  x: number;
  blush: string;
  breathDelay: number;
  m: DumplingMotions;
  colors: ThemeColors;
}) {
  const base = dumplingBase(x);
  const frame = dumplingFrame(x);
  const dot = (cx: number) => [x + cx * D, 57 + 47 * D] as const;
  const blushDot = (cx: number) => (
    <Layer
      motion={m.blush}
      rest={m.blushRest}
      origin={dot(cx)}
      frame={frame}
      art={<Circle cx={cx} cy={47} r={4.5} fill={blush} />}
    />
  );
  const closes = m.eyesClosed !== undefined;
  return (
    <Layer motion={m.body} rest={m.bodyRest} origin={base}>
      <Layer
        motion={breath(breathDelay)}
        origin={base}
        frame={frame}
        art={
          <>
            <Dough colors={colors} />
            <Mouth face="smile" colors={colors} />
          </>
        }
      >
        <Layer
          motion={m.eyesOpen}
          rest={m.eyesOpenRest === undefined ? undefined : { op: m.eyesOpenRest }}
          frame={frame}
          art={<Eyes face="smile" colors={colors} />}
        />
        {closes ? (
          <Layer
            motion={m.eyesClosed}
            rest={{ op: m.eyesClosedRest ?? 1 }}
            frame={frame}
            art={
              <Path
                d={CLOSED_EYES}
                fill="none"
                stroke={colors.onYou}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            }
          />
        ) : null}
        {blushDot(24)}
        {blushDot(56)}
      </Layer>
    </Layer>
  );
}

/** A blush heart at a canvas point, `scale` of the art's 18-unit width. */
function HeartLayer({
  at,
  scale,
  motion,
  rest,
  colors,
}: {
  at: readonly [number, number];
  scale: number;
  motion: Motion;
  rest: Partial<Pose>;
  colors: ThemeColors;
}) {
  return (
    <Layer
      motion={motion}
      rest={rest}
      origin={at}
      frame={`translate(${at[0]} ${at[1]}) scale(${scale})`}
      art={<Path d={HEART} fill={colors.blush} />}
    />
  );
}

type Scene = {
  actor: DumplingMotions;
  target: DumplingMotions;
  /** Drawn behind the dumplings (sky, stars, sun, thread, steam). */
  back?: ReactNode;
  /** Drawn in front (lid, hearts, heartbeat, z's). */
  front?: ReactNode;
};

function hugScene(amount: number, d: number, colors: ThemeColors): Scene {
  const dur = hugMs(amount);
  const squeeze = { sx: [1, 1, 1.06, 1.06, 1], sy: [1, 1, 0.94, 0.94, 1] };
  const blush = once({ at: [0, 0.3, 0.8, 1], ...sx([1, 1.45, 1.45, 1]) }, dur, 'easeInOut');
  const blushRest = { sx: 1.45, sy: 1.45 };
  const heartAt = [stageX(160), stageY(70)] as const;
  return {
    actor: {
      body: once(
        {
          at: [0, 0.18, 0.3, 0.8, 1],
          tx: [0, 22 * d * D, 20 * d * D, 20 * d * D, 0],
          rot: [0, 6 * d, 4 * d, 4 * d, 0],
          ...squeeze,
        },
        dur,
        'standard',
      ),
      bodyRest: { tx: 20 * d * D, rot: 4 * d, sx: 1.06, sy: 0.94 },
      blush,
      blushRest,
    },
    target: {
      body: once(
        {
          at: [0, 0.12, 0.3, 0.8, 1],
          tx: [0, 0, -10 * d * D, -10 * d * D, 0],
          rot: [0, 0, -4 * d, -4 * d, 0],
          ...squeeze,
        },
        dur,
        'standard',
      ),
      bodyRest: { tx: -10 * d * D, rot: -4 * d, sx: 1.06, sy: 0.94 },
      blush,
      blushRest,
    },
    back: <SteamPair colors={colors} />,
    front: (
      <HeartLayer
        at={heartAt}
        scale={1.6 * K}
        colors={colors}
        // `pop`, 250 ms after the hug starts.
        motion={once(
          {
            at: [0, 0.25, 0.7, 1],
            ty: [8 * K, -6 * K, -14 * K, -26 * K],
            ...sx([0.3, 1.15, 1, 0.9]),
            op: [0, 1, 1, 0],
          },
          dur,
          'squish',
          250,
        )}
        rest={{ ty: -14 * K }}
      />
    ),
  };
}

function kissScene(amount: number, d: number, colors: ThemeColors): Scene {
  const n = kisses(amount);
  // `popS`: a little heart pops by the target's cheek and floats off, once per kiss.
  const popS = (delay: number) =>
    once(
      {
        at: [0, 0.3, 1],
        tx: [0, 4 * d * K, 10 * d * K],
        ty: [0, -8 * K, -26 * K],
        ...sx([0.2, 1.1, 0.8]),
        op: [0, 1, 0],
      },
      KISS_MS,
      'squish',
      delay,
      n,
    );
  const popRest = { tx: 4 * d * K, ty: -8 * K, sx: 1.1, sy: 1.1 };
  const cheek = d > 0 ? 184 : 136;
  return {
    actor: {
      body: once(
        {
          at: [0, 0.35, 0.55, 1],
          tx: [0, 14 * d * D, 18 * d * D, 0],
          ty: [0, -14 * D, -4 * D, 0],
          rot: [0, 12 * d, 14 * d, 0],
          sx: [1, 1, 1.03, 1],
          sy: [1, 1, 0.97, 1],
        },
        KISS_MS,
        'squish',
        0,
        n,
      ),
      // The peck.
      bodyRest: { tx: 18 * d * D, ty: -4 * D, rot: 14 * d, sx: 1.03, sy: 0.97 },
    },
    target: {
      body: once(
        { at: [0, 0.4, 0.58, 1], rot: [0, 0, -5 * d, 0], sx: [1, 1, 1.05, 1], sy: [1, 1, 0.95, 1] },
        KISS_MS,
        'squish',
        0,
        n,
      ),
      bodyRest: { rot: -5 * d, sx: 1.05, sy: 0.95 },
      blush: once({ at: [0, 0.45, 0.6, 1], ...sx([1, 1, 1.7, 1]) }, KISS_MS, 'easeInOut', 0, n),
      blushRest: { sx: 1.7, sy: 1.7 },
    },
    back: <SteamPair colors={colors} />,
    front: (
      <>
        <HeartLayer
          at={[stageX(cheek), stageY(112)]}
          scale={0.9 * K}
          motion={popS(350)}
          rest={popRest}
          colors={colors}
        />
        <HeartLayer
          at={[stageX(cheek + 12 * d), stageY(100)]}
          scale={0.65 * K}
          motion={popS(480)}
          rest={popRest}
          colors={colors}
        />
      </>
    ),
  };
}

/** Night sky: stars in three twinkle groups (the prototype's nth-child delays), compressed into
 * the square canvas; radius in canvas units. */
const STARS: readonly (readonly [number, number, number])[][] = [
  [
    [8, 30, 1.1],
    [36, 36, 1],
    [70, 26, 0.9],
    [96, 54, 0.8],
  ],
  [
    [22, 14, 0.9],
    [84, 12, 1],
    [14, 50, 0.8],
  ],
  [
    [56, 8, 0.8],
    [112, 40, 1.1],
  ],
];
const TWINKLE_DELAYS = [0, 700, 1400];

function nightScene(d: number): Scene {
  const T = NIGHT_MS;
  const fadeIn = (ms: number, delay: number) =>
    once({ at: [0, 1], op: [0, 1] }, ms, 'standard', delay);
  const moon = [104, 22] as const;
  const zz = (delay: number): Motion => ({
    keyframes: {
      at: [0, 0.3, 1],
      tx: [0, 2.4 * K, 8 * K],
      ty: [6 * K, -1.2 * K, -18 * K],
      op: [0, 1, 0],
    },
    duration: 2600,
    ease: 'easeInOut',
    delay,
  });
  const zee = (x: number, y: number, w: number, delay: number) => (
    <Layer
      motion={zz(delay)}
      rest={{ op: 1 }}
      frame={`translate(${x} ${y})`}
      art={
        <Path
          d={`M0 0 h${w} l-${w} ${w} h${w}`}
          fill="none"
          stroke={palettes.dark.partnerText}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      }
    />
  );
  const eyes: DumplingMotions = {
    eyesOpen: once({ at: [0, 1], op: [1, 0] }, 300, 'linear', 1000),
    eyesOpenRest: 0,
    eyesClosed: once({ at: [0, 1], op: [0, 1] }, 300, 'linear', 1100),
    eyesClosedRest: 1,
  };
  return {
    actor: {
      ...eyes,
      body: once({ at: [0, 1], tx: [0, 10 * d * D], rot: [0, 8 * d] }, 1400, 'standard', 300),
      bodyRest: { tx: 10 * d * D, rot: 8 * d },
    },
    target: {
      ...eyes,
      body: once({ at: [0, 1], tx: [0, -6 * d * D], rot: [0, -6 * d] }, 1400, 'standard', 450),
      bodyRest: { tx: -6 * d * D, rot: -6 * d },
    },
    back: (
      <Layer motion={outro(T)}>
        <Layer
          motion={fadeIn(900, 0)}
          art={<Rect width={120} height={120} rx={20} fill={palettes.dark.partnerTint} />}
        />
        <Layer motion={fadeIn(1000, 400)}>
          {STARS.map((group, i) => (
            <Layer
              key={i}
              motion={{
                keyframes: { at: [0, 0.5, 1], op: [1, 0.3, 1] },
                duration: 2200,
                ease: 'easeInOut',
                delay: TWINKLE_DELAYS[i] ?? 0,
              }}
              art={
                <>
                  {group.map(([cx, cy, r]) => (
                    <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={palettes.dark.text} />
                  ))}
                </>
              }
            />
          ))}
        </Layer>
        <Layer
          motion={once({ at: [0, 1], ty: [24 * K, 0], op: [0, 1] }, 1400, 'standard', 200)}
          frame={`translate(${moon[0]} ${moon[1]}) scale(${1.4 * K})`}
          art={
            <Path
              d="M10 9.5A11 11 0 0 1 -4.5 -5 11 11 0 1 0 10 9.5z"
              fill={palettes.light.premiumTint}
            />
          }
        />
      </Layer>
    ),
    front: (
      <Layer motion={outro(T)}>
        {zee(stageX(240), stageY(86), 7 * K, 1400)}
        {zee(stageX(254), stageY(70), 6 * K, 2100)}
      </Layer>
    ),
  };
}

function morningScene(colors: ThemeColors): Scene {
  const T = MORNING_MS;
  const sun = [stageX(160), stageY(132)] as const;
  const lidCentre = [60, 72] as const;
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5;
    const r1 = 34 * K;
    const r2 = 44 * K;
    return `M${(Math.cos(a) * r1).toFixed(2)} ${(Math.sin(a) * r1).toFixed(2)} L${(Math.cos(a) * r2).toFixed(2)} ${(Math.sin(a) * r2).toFixed(2)}`;
  }).join(' ');
  const stretch = (delay: number) =>
    once(
      { at: [0, 0.4, 0.7, 1], sx: [1, 0.92, 1.04, 1], sy: [1, 1.12, 0.96, 1] },
      1200,
      'squish',
      delay,
    );
  const eyes: DumplingMotions = {
    // `wake` / `wakeC`: asleep, eyes open, a blink, awake.
    eyesOpen: once({ at: [0, 0.45, 0.55, 0.62, 0.7, 1], op: [0, 0, 1, 0.1, 1, 1] }, 1600, 'linear'),
    eyesOpenRest: 1,
    eyesClosed: once({ at: [0, 0.45, 0.55, 1], op: [1, 1, 0, 0] }, 1600, 'linear'),
    eyesClosedRest: 0,
  };
  return {
    actor: { ...eyes, body: stretch(900) },
    target: { ...eyes, body: stretch(1050) },
    back: (
      <>
        <Layer motion={outro(T)}>
          <Layer
            motion={once({ at: [0, 1], op: [0, 1] }, 900, 'standard')}
            art={<Rect width={120} height={120} rx={20} fill={palettes.light.youTint} />}
          />
          <Layer
            motion={once({ at: [0, 1], ty: [40 * K, 0], op: [0, 1] }, 1600, 'standard')}
            origin={sun}
            frame={`translate(${sun[0]} ${sun[1]})`}
            art={<Circle r={26 * K} fill={palettes.light.you} opacity={0.6} />}
          >
            <Layer
              motion={{
                keyframes: { at: [0, 1], rot: [0, 360] },
                duration: 14000,
                ease: 'linear',
              }}
              origin={sun}
              frame={`translate(${sun[0]} ${sun[1]})`}
              art={
                <Path
                  d={rays}
                  stroke={palettes.light.you}
                  strokeOpacity={0.75}
                  strokeWidth={3 * K}
                  strokeLinecap="round"
                />
              }
            />
          </Layer>
        </Layer>
        <SteamPair colors={colors} />
      </>
    ),
    front: (
      <Layer
        // `lidOff`: up, a tilt, then away to the right.
        motion={once(
          {
            at: [0, 0.4, 1],
            tx: [0, 0, 70 * K],
            ty: [0, -20 * K, -40 * K],
            rot: [0, -6, 18],
            op: [1, 1, 0],
          },
          1400,
          'standard',
          200,
        )}
        rest={{ op: 0 }}
        origin={lidCentre}
        art={<LidArt colors={colors} />}
      />
    ),
  };
}

function missScene(d: number, colors: ThemeColors): Scene {
  const T = MISS_MS;
  const apart = (dir: number) =>
    once({ at: [0, 0.2, 0.75, 1], tx: [0, dir * D, dir * D, 0] }, T, 'standard');
  const from = [stageX(114), stageY(112)] as const;
  const beatAt = [stageX(160), stageY(104)] as const;
  const far = 44 * d * K;
  return {
    actor: { body: apart(-26 * d), bodyRest: { tx: -26 * d * D } },
    target: { body: apart(26 * d), bodyRest: { tx: 26 * d * D } },
    back: (
      <>
        <Layer
          // `thread`: drawn in from its start (the prototype animates the dash), held, faded.
          motion={once(
            {
              at: [0, 0.15, 0.35, 0.75, 0.9, 1],
              sx: [0, 0, 1, 1, 1, 1],
              op: [0, 0, 1, 1, 0, 0],
            },
            T,
            'standard',
          )}
          rest={{ op: 1 }}
          origin={from}
          art={
            <Path
              d={`M${from[0]} ${from[1]} C ${stageX(140)} ${stageY(92)}, ${stageX(180)} ${stageY(92)}, ${stageX(206)} ${stageY(112)}`}
              fill="none"
              stroke={colors.blush}
              strokeWidth={2.5 * K}
              strokeLinecap="round"
            />
          }
        />
        <SteamPair colors={colors} />
      </>
    ),
    front: (
      <HeartLayer
        at={beatAt}
        scale={1.1 * K}
        colors={colors}
        // `beatTravel`: appears by the actor, travels to the other, beats twice there.
        motion={once(
          {
            at: [0, 0.3, 0.4, 0.62, 0.7, 0.76, 0.82, 0.9, 1],
            tx: [-far, -far, -far * 0.375, far, far, far, far, far, far],
            sx: [0.6, 0.6, 0.73, 1, 1.3, 1, 1.25, 1, 1],
            sy: [0.6, 0.6, 0.73, 1, 1.3, 1, 1.25, 1, 1],
            op: [0, 0, 1, 1, 1, 1, 1, 0, 0],
          },
          T,
          'standard',
        )}
        rest={{ tx: far }}
      />
    ),
  };
}

/** Two curls of steam, as on the prototype's stage (not at night). */
function SteamPair({ colors }: { colors: ThemeColors }) {
  return (
    <>
      <Steam x={stageX(124)} colors={colors} />
      <Steam x={stageX(196)} delay={1300} colors={colors} />
    </>
  );
}

function sceneFor(gesture: MascotGesture, d: number, colors: ThemeColors): Scene {
  switch (gesture.kind) {
    case 'hug':
      return hugScene(gesture.amount, d, colors);
    case 'kiss':
      return kissScene(gesture.amount, d, colors);
    case 'goodnight':
      return nightScene(d);
    case 'good_morning':
      return morningScene(colors);
    case 'miss_you':
      return missScene(d, colors);
  }
}

/**
 * One gesture moment on the 120 × 120 canvas (inside `RigRoot`). Bao is the viewer (left, orange
 * blush), Bun the partner (right, sky blush), on both phones (DESIGN.md Rule 1).
 */
export function GestureScene({
  gesture,
  colors,
}: {
  gesture: MascotGesture;
  colors: ThemeColors;
}): ReactNode {
  const d = gesture.actor === 'you' ? 1 : -1;
  const scene = useMemo(() => sceneFor(gesture, d, colors), [gesture, d, colors]);
  const bao = personColors(colors, true).fill;
  const bun = personColors(colors, false).fill;
  const baoMotions = gesture.actor === 'you' ? scene.actor : scene.target;
  const bunMotions = gesture.actor === 'you' ? scene.target : scene.actor;
  return (
    <>
      {scene.back}
      <GestureDumpling x={BAO_X} blush={bao} breathDelay={0} m={baoMotions} colors={colors} />
      <GestureDumpling x={BUN_X} blush={bun} breathDelay={600} m={bunMotions} colors={colors} />
      <Basket colors={colors} />
      {scene.front}
    </>
  );
}
