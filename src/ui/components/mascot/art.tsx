import type { ReactNode } from 'react';
import { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { personColors, type ThemeColors } from '../../theme';
import { DUMPLING_SCALE } from './motion';
import { Layer } from './rig';

/**
 * Bao and Bun's parts and the six mood scenes (DESIGN.md §5), drawn on the 120 × 120 canvas of
 * `design-handoff/assets/mascot/*.svg`. Motions per mood follow the "Dim and Sum mascot" board in
 * `design-handoff/Couples App — Full Flow.html`: who breathes, blinks, bounces or sways, where the
 * steam rises, and the delays that keep the two dumplings out of step.
 * Parts are exported for MOB-66 (the little-things gestures build their scenes from them).
 */

export type Face = 'smile' | 'sleep' | 'cheer' | 'flat';

export const DOUGH_PATH = 'M4 60 C0 40 14 14 40 12 C66 14 80 40 76 60 Z';
const PLEATS = 'M30 16 Q35 22 39 13 M50 16 Q45 22 41 13 M22 25 Q32 27 37 15 M58 25 Q48 27 43 15';
const STEAM = 'M0 0 q-4 -6 0 -12 q4 -6 0 -12';
export const HEART =
  'M0 8 C-5 3 -9 1 -9 -3 C-9 -6 -7 -8 -4.5 -8 C-2.5 -8 -0.8 -7 0 -5 C0.8 -7 2.5 -8 4.5 -8 C7 -8 9 -6 9 -3 C9 1 5 3 0 8 Z';

/** Dumplings stand with their art origin at (x, 57); the base is 60 units down, scaled. */
const DUMPLING_Y = 57;
const dumplingFrame = (x: number) => `translate(${x} ${DUMPLING_Y}) scale(${DUMPLING_SCALE})`;
/** Bottom centre of a dumpling on the canvas: where it squashes, bounces and sways from. */
export const dumplingBase = (x: number) =>
  [x + 40 * DUMPLING_SCALE, DUMPLING_Y + 60 * DUMPLING_SCALE] as const;
/** Centre of a dumpling's eyes on the canvas: where it blinks from. */
const eyeCentre = (x: number, look: number) =>
  [x + (40 + look) * DUMPLING_SCALE, DUMPLING_Y + 40 * DUMPLING_SCALE] as const;

type Body = 'breathe' | 'sleepyBreathe' | 'bounce';

export type DumplingProps = {
  /** Left edge of the art on the canvas (Bao 10–14, Bun 52–56). */
  x: number;
  blush: string;
  face: Face;
  /** Shift of the face towards the other dumpling. */
  look: number;
  showFace: boolean;
  blushOpacity?: number;
  colors: ThemeColors;
  /** How the body moves (none = still body). */
  body?: Body;
  bodyDelay?: number;
  /** Sway from the base (the one who is awake and waiting). */
  sway?: boolean;
  /** Blink delay; eyes blink when the face has open eyes. */
  blinkDelay?: number;
};

const ink = (colors: ThemeColors) => colors.onYou; // #2A1407 in both schemes: the dough is light.

function Eyes({ face, colors }: { face: Face; colors: ThemeColors }) {
  if (face !== 'smile' && face !== 'flat') return null;
  return (
    <>
      <Circle cx={31} cy={40} r={3} fill={ink(colors)} />
      <Circle cx={49} cy={40} r={3} fill={ink(colors)} />
    </>
  );
}

function Mouth({ face, colors }: { face: Face; colors: ThemeColors }) {
  const stroke = {
    stroke: ink(colors),
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    fill: 'none',
  };
  switch (face) {
    case 'smile':
      return <Path d="M36 46 Q40 50 44 46" {...stroke} />;
    case 'flat':
      return <Path d="M37 47 H43" {...stroke} />;
    case 'sleep':
      return <Path d="M27 40 Q31 43 35 40 M45 40 Q49 43 53 40" {...stroke} />;
    case 'cheer':
      return (
        <>
          <Path d="M26 40 Q31 35 36 40 M44 40 Q49 35 54 40" {...stroke} />
          <Path d="M35 45 Q40 53 45 45 Z" fill={ink(colors)} />
        </>
      );
  }
}

/** The dough, pleats and knot (no face): also the shape of an empty seat. */
function Dough({ colors }: { colors: ThemeColors }) {
  return (
    <>
      <Path
        d={DOUGH_PATH}
        fill={colors.dough}
        stroke={colors.doughLine}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <Path
        d={PLEATS}
        fill="none"
        stroke={colors.doughLine}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <Circle
        cx={40}
        cy={12}
        r={3}
        fill={colors.dough}
        stroke={colors.doughLine}
        strokeWidth={2.5}
      />
    </>
  );
}

/** Bao or Bun. Blush is relative to the viewer (Bao = me), DESIGN.md Rule 1. */
export function Dumpling({
  x,
  blush,
  face,
  look,
  showFace,
  blushOpacity = 1,
  colors,
  body,
  bodyDelay = 0,
  sway = false,
  blinkDelay = 0,
}: DumplingProps) {
  const base = dumplingBase(x);
  const frame = dumplingFrame(x);
  const blinks = showFace && (face === 'smile' || face === 'flat');
  const art = (
    <>
      <Dough colors={colors} />
      {showFace && (
        <G transform={`translate(${look} 0)`}>
          {!blinks && <Eyes face={face} colors={colors} />}
          <Mouth face={face} colors={colors} />
        </G>
      )}
      <Circle cx={24} cy={47} r={4.5} fill={blush} opacity={blushOpacity} />
      <Circle cx={56} cy={47} r={4.5} fill={blush} opacity={blushOpacity} />
    </>
  );
  const dumpling = (
    <Layer motion={body} delay={bodyDelay} origin={base} frame={frame} art={art}>
      {blinks && (
        <Layer
          motion="blink"
          delay={blinkDelay}
          origin={eyeCentre(x, look)}
          frame={`${frame} translate(${look} 0)`}
          art={<Eyes face={face} colors={colors} />}
        />
      )}
    </Layer>
  );
  return sway ? (
    <Layer motion="wobble" origin={base}>
      {dumpling}
    </Layer>
  ) : (
    dumpling
  );
}

/** The dashed outline where the partner will sit (saving-a-seat). */
export function EmptySeat({ x, colors }: { x: number; colors: ThemeColors }) {
  return (
    <Layer
      frame={dumplingFrame(x)}
      art={
        <Path
          d={DOUGH_PATH}
          fill="none"
          stroke={colors.doughLine}
          strokeWidth={3}
          strokeDasharray="6 6"
        />
      }
    />
  );
}

export function Basket({ colors }: { colors: ThemeColors }) {
  return <Layer art={<BasketArt colors={colors} />} />;
}

function BasketArt({ colors }: { colors: ThemeColors }) {
  return (
    <>
      <Rect x={8} y={94} width={104} height={18} rx={6} fill={colors.bamboo} />
      <Path d="M12 102 H108" stroke={colors.bambooDark} strokeWidth={2} />
    </>
  );
}

/** A curl of steam above (x, 50): activity. Still: 80 % opacity. */
export function Steam({ x, delay, colors }: { x: number; delay?: number; colors: ThemeColors }) {
  return (
    <Layer
      motion="steam"
      delay={delay}
      restOpacity={0.8}
      frame={`translate(${x} 50)`}
      art={
        <Path
          d={STEAM}
          fill="none"
          stroke={colors.doughLine}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      }
    />
  );
}

/** A blush heart at (60, y) that pops and floats up. */
export function Heart({ y, colors }: { y: number; colors: ThemeColors }) {
  return (
    <Layer
      motion="heartHop"
      origin={[60, y]}
      frame={`translate(60 ${y})`}
      art={<Path d={HEART} fill={colors.blush} />}
    />
  );
}

function Seed({ cx, cy, fill, delay }: { cx: number; cy: number; fill: string; delay: number }) {
  return (
    <Layer
      motion="confetti"
      delay={delay}
      art={<Ellipse cx={cx} cy={cy} rx={2.4} ry={1.4} fill={fill} />}
    />
  );
}

function Zee({
  x,
  y,
  w,
  strokeWidth,
  delay,
  colors,
}: {
  x: number;
  y: number;
  w: number;
  strokeWidth: number;
  delay: number;
  colors: ThemeColors;
}) {
  return (
    <Layer
      motion="snore"
      delay={delay}
      frame={`translate(${x} ${y})`}
      art={
        <Path
          d={`M0 0 h${w} l-${w} ${w} h${w}`}
          fill="none"
          stroke={colors.bambooDark}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      }
    />
  );
}

/** The closed steamer (napping): rest, never sad. */
function Lid({ colors }: { colors: ThemeColors }) {
  return (
    <Layer
      art={
        <>
          <BasketArt colors={colors} />
          <Path
            d="M10 96 C10 50 110 50 110 96 Z"
            fill={colors.doughLine}
            stroke={colors.bambooDark}
            strokeWidth={2}
          />
          <Path
            d="M22 84 C34 70 86 70 98 84"
            fill="none"
            stroke={colors.bamboo}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <Rect x={52} y={48} width={16} height={8} rx={3} fill={colors.bambooDark} />
        </>
      }
    />
  );
}

/** The six moods of Bao (you) and Bun (your partner), DESIGN.md §5. */
export type MascotMood =
  'together' | 'celebrating' | 'waiting' | 'snuggled' | 'saving-a-seat' | 'napping';

export function MoodScene({
  mood,
  awake,
  showFace,
  colors,
}: {
  mood: MascotMood;
  awake: 'you' | 'partner';
  showFace: boolean;
  colors: ThemeColors;
}): ReactNode {
  const bao = personColors(colors, true).fill;
  const bun = personColors(colors, false).fill;
  const common = { showFace, colors };

  switch (mood) {
    case 'napping':
      return (
        <>
          <Zee x={88} y={40} w={8} strokeWidth={2.2} delay={0} colors={colors} />
          <Zee x={97} y={28} w={7} strokeWidth={2} delay={1000} colors={colors} />
          <Zee x={105} y={17} w={6} strokeWidth={1.8} delay={2000} colors={colors} />
          <Lid colors={colors} />
        </>
      );
    case 'together':
      return (
        <>
          <Steam x={46} colors={colors} />
          <Steam x={76} delay={1200} colors={colors} />
          <Dumpling
            x={56}
            blush={bun}
            face="smile"
            look={0}
            body="breathe"
            bodyDelay={400}
            blinkDelay={1300}
            {...common}
          />
          <Dumpling x={10} blush={bao} face="smile" look={0} body="breathe" {...common} />
          <Basket colors={colors} />
        </>
      );
    case 'celebrating':
      return (
        <>
          <Seed cx={18} cy={14} fill={colors.onYou} delay={0} />
          <Seed cx={40} cy={8} fill={colors.doughLine} delay={500} />
          <Seed cx={84} cy={10} fill={colors.onYou} delay={1000} />
          <Seed cx={104} cy={16} fill={colors.doughLine} delay={300} />
          <Heart y={34} colors={colors} />
          <Dumpling
            x={56}
            blush={bun}
            face="cheer"
            look={0}
            body="bounce"
            bodyDelay={800}
            {...common}
          />
          <Dumpling x={10} blush={bao} face="cheer" look={0} body="bounce" {...common} />
          <Basket colors={colors} />
        </>
      );
    case 'snuggled':
      return (
        <>
          <Heart y={36} colors={colors} />
          <Dumpling
            x={52}
            blush={bun}
            face="smile"
            look={-3}
            body="breathe"
            bodyDelay={400}
            blinkDelay={1300}
            {...common}
          />
          <Dumpling x={14} blush={bao} face="smile" look={3} body="breathe" {...common} />
          <Basket colors={colors} />
        </>
      );
    case 'waiting': {
      // The awake one steams, sways and looks at the other; the other sleeps, breathing slowly.
      const baoAwake = awake === 'you';
      return (
        <>
          <Steam x={baoAwake ? 40 : 80} colors={colors} />
          <Dumpling
            x={56}
            blush={bun}
            face={baoAwake ? 'sleep' : 'flat'}
            look={baoAwake ? 0 : -3}
            blushOpacity={baoAwake ? 0.5 : 1}
            body={baoAwake ? 'sleepyBreathe' : 'breathe'}
            sway={!baoAwake}
            {...common}
          />
          <Dumpling
            x={10}
            blush={bao}
            face={baoAwake ? 'flat' : 'sleep'}
            look={baoAwake ? 3 : 0}
            blushOpacity={baoAwake ? 1 : 0.5}
            body={baoAwake ? 'breathe' : 'sleepyBreathe'}
            sway={baoAwake}
            {...common}
          />
          <Basket colors={colors} />
        </>
      );
    }
    case 'saving-a-seat':
      return (
        <>
          <EmptySeat x={62} colors={colors} />
          <Steam x={36} colors={colors} />
          <Dumpling x={10} blush={bao} face="smile" look={3} body="breathe" sway {...common} />
          <Basket colors={colors} />
        </>
      );
  }
}
