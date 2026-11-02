import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { useTranslation } from '@/i18n';

import { personColors, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeProvider';

/** The six moods of Bao (you) and Bun (your partner), DESIGN.md §5. */
export type MascotMood =
  'together' | 'celebrating' | 'waiting' | 'snuggled' | 'saving-a-seat' | 'napping';

export const mascotMoods: readonly MascotMood[] = [
  'together',
  'celebrating',
  'waiting',
  'snuggled',
  'saving-a-seat',
  'napping',
];

/** DESIGN.md §5: never smaller than 24. Below FACE_MIN the eyes and mouth go; the blush dots stay. */
export const MASCOT_MIN_SIZE = 24;
export const MASCOT_FACE_MIN_SIZE = 40;

type Face = 'smile' | 'sleep' | 'cheer' | 'flat';

type Props = {
  mood: MascotMood;
  /** Width and height in points (square). Default 120, clamped to 24 or more. */
  size?: number;
  /** For the screen-reader label ("Sam hasn't answered yet"). */
  partnerName?: string;
  /**
   * Only for `waiting`: who is awake and waiting. `you` (default) = you answered and your partner
   * hasn't; `partner` = the reverse. Bao is always you (orange blush), Bun always your partner.
   */
  awake?: 'you' | 'partner';
  /** Replaces the generated label (rarely needed). */
  accessibilityLabel?: string;
  testID?: string;
};

// Art from design-handoff/assets/mascot/*.svg, on its 120 × 120 canvas. Bao stands on the left.
const DOUGH_PATH = 'M4 60 C0 40 14 14 40 12 C66 14 80 40 76 60 Z';
const PLEATS = 'M30 16 Q35 22 39 13 M50 16 Q45 22 41 13 M22 25 Q32 27 37 15 M58 25 Q48 27 43 15';
const STEAM = 'M0 0 q-4 -6 0 -12 q4 -6 0 -12';
const HEART =
  'M0 8 C-5 3 -9 1 -9 -3 C-9 -6 -7 -8 -4.5 -8 C-2.5 -8 -0.8 -7 0 -5 C0.8 -7 2.5 -8 4.5 -8 C7 -8 9 -6 9 -3 C9 1 5 3 0 8 Z';

type DumplingProps = {
  x: number;
  blush: string;
  face: Face;
  /** Shift of the face towards the other dumpling (the art leans eyes and mouth slightly). */
  look: number;
  showFace: boolean;
  blushOpacity?: number;
  colors: ThemeColors;
};

function Dumpling({ x, blush, face, look, showFace, blushOpacity = 1, colors }: DumplingProps) {
  const ink = colors.onYou; // #2A1407 in both schemes: the dough is light in both.
  const stroke = { stroke: ink, strokeWidth: 2.5, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <G transform={`translate(${x} 57) scale(0.62)`}>
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
      {showFace && (
        <G transform={`translate(${look} 0)`}>
          {face === 'smile' && (
            <>
              <Circle cx={31} cy={40} r={3} fill={ink} />
              <Circle cx={49} cy={40} r={3} fill={ink} />
              <Path d="M36 46 Q40 50 44 46" {...stroke} />
            </>
          )}
          {face === 'flat' && (
            <>
              <Circle cx={31} cy={40} r={3} fill={ink} />
              <Circle cx={49} cy={40} r={3} fill={ink} />
              <Path d="M37 47 H43" {...stroke} />
            </>
          )}
          {face === 'sleep' && <Path d="M27 40 Q31 43 35 40 M45 40 Q49 43 53 40" {...stroke} />}
          {face === 'cheer' && (
            <>
              <Path d="M26 40 Q31 35 36 40 M44 40 Q49 35 54 40" {...stroke} />
              <Path d="M35 45 Q40 53 45 45 Z" fill={ink} />
            </>
          )}
        </G>
      )}
      <Circle cx={24} cy={47} r={4.5} fill={blush} opacity={blushOpacity} />
      <Circle cx={56} cy={47} r={4.5} fill={blush} opacity={blushOpacity} />
    </G>
  );
}

function Basket({ colors }: { colors: ThemeColors }) {
  return (
    <>
      <Rect x={8} y={94} width={104} height={18} rx={6} fill={colors.bamboo} />
      <Path d="M12 102 H108" stroke={colors.bambooDark} strokeWidth={2} />
    </>
  );
}

function Steam({ x, colors }: { x: number; colors: ThemeColors }) {
  return (
    <G transform={`translate(${x} 50)`}>
      <Path
        d={STEAM}
        fill="none"
        stroke={colors.doughLine}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.8}
      />
    </G>
  );
}

function Heart({ y, colors }: { y: number; colors: ThemeColors }) {
  return (
    <G transform={`translate(60 ${y})`}>
      <Path d={HEART} fill={colors.blush} />
    </G>
  );
}

function Napping({ colors }: { colors: ThemeColors }) {
  const z = { fill: 'none', stroke: colors.bambooDark, strokeLinecap: 'round' as const };
  return (
    <>
      <G transform="translate(88 40)">
        <Path d="M0 0 h8 l-8 8 h8" strokeWidth={2.2} strokeLinejoin="round" {...z} />
      </G>
      <G transform="translate(97 28)">
        <Path d="M0 0 h7 l-7 7 h7" strokeWidth={2} strokeLinejoin="round" {...z} />
      </G>
      <G transform="translate(105 17)">
        <Path d="M0 0 h6 l-6 6 h6" strokeWidth={1.8} strokeLinejoin="round" {...z} />
      </G>
      <Basket colors={colors} />
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
  );
}

function Art({
  mood,
  awake,
  showFace,
  colors,
}: {
  mood: MascotMood;
  awake: 'you' | 'partner';
  showFace: boolean;
  colors: ThemeColors;
}) {
  const bao = personColors(colors, true).fill;
  const bun = personColors(colors, false).fill;
  const common = { showFace, colors };

  switch (mood) {
    case 'napping':
      return <Napping colors={colors} />;
    case 'together':
      return (
        <>
          <Steam x={46} colors={colors} />
          <Steam x={76} colors={colors} />
          <Dumpling x={56} blush={bun} face="smile" look={0} {...common} />
          <Dumpling x={10} blush={bao} face="smile" look={0} {...common} />
          <Basket colors={colors} />
        </>
      );
    case 'celebrating':
      return (
        <>
          <Ellipse cx={18} cy={14} rx={2.4} ry={1.4} fill={colors.onYou} />
          <Ellipse cx={40} cy={8} rx={2.4} ry={1.4} fill={colors.doughLine} />
          <Ellipse cx={84} cy={10} rx={2.4} ry={1.4} fill={colors.onYou} />
          <Ellipse cx={104} cy={16} rx={2.4} ry={1.4} fill={colors.doughLine} />
          <Heart y={34} colors={colors} />
          <Dumpling x={56} blush={bun} face="cheer" look={0} {...common} />
          <Dumpling x={10} blush={bao} face="cheer" look={0} {...common} />
          <Basket colors={colors} />
        </>
      );
    case 'snuggled':
      return (
        <>
          <Heart y={36} colors={colors} />
          <Dumpling x={52} blush={bun} face="smile" look={-3} {...common} />
          <Dumpling x={14} blush={bao} face="smile" look={3} {...common} />
          <Basket colors={colors} />
        </>
      );
    case 'waiting': {
      // The awake one is steaming and looking at the other; the other sleeps with soft blush.
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
            {...common}
          />
          <Dumpling
            x={10}
            blush={bao}
            face={baoAwake ? 'flat' : 'sleep'}
            look={baoAwake ? 3 : 0}
            blushOpacity={baoAwake ? 1 : 0.5}
            {...common}
          />
          <Basket colors={colors} />
        </>
      );
    }
    case 'saving-a-seat':
      return (
        <>
          <G transform="translate(62 57) scale(0.62)">
            <Path
              d={DOUGH_PATH}
              fill="none"
              stroke={colors.doughLine}
              strokeWidth={3}
              strokeDasharray="6 6"
            />
          </G>
          <Steam x={36} colors={colors} />
          <Dumpling x={10} blush={bao} face="smile" look={3} {...common} />
          <Basket colors={colors} />
        </>
      );
  }
}

const moodKey = {
  together: 'ui.mascot.together',
  celebrating: 'ui.mascot.celebrating',
  snuggled: 'ui.mascot.snuggled',
  'saving-a-seat': 'ui.mascot.savingASeat',
  napping: 'ui.mascot.napping',
} as const;

/**
 * Bao and Bun as a still pose (MOB-05). One accessibility element whose label describes the
 * state. Bao is always the viewer (orange blush), Bun their partner (sky blush). The animated
 * Rive version (D32, MOB-31) will sit behind this same API; until then every mood is a still,
 * which is also what reduced motion shows.
 */
export function Mascot({
  mood,
  size = 120,
  partnerName,
  awake = 'you',
  accessibilityLabel,
  testID,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const dimension = Math.max(size, MASCOT_MIN_SIZE);
  const partner = partnerName?.trim() || t('ui.mascot.partnerFallback');
  const label =
    accessibilityLabel ??
    (mood === 'waiting'
      ? t(awake === 'you' ? 'ui.mascot.waitingPartner' : 'ui.mascot.waitingYou', { partner })
      : t(moodKey[mood], { partner }));

  return (
    <Svg
      testID={testID}
      width={dimension}
      height={dimension}
      viewBox="0 0 120 120"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Art mood={mood} awake={awake} showFace={dimension >= MASCOT_FACE_MIN_SIZE} colors={colors} />
    </Svg>
  );
}
