import { useTranslation } from '@/i18n';

import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';
import { MoodScene, type MascotMood } from './mascot/art';
import { RigRoot } from './mascot/rig';

export type { MascotMood } from './mascot/art';

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
  /** Always the still pose (widgets, icons, notification previews). */
  still?: boolean;
  testID?: string;
};

const moodKey = {
  together: 'ui.mascot.together',
  celebrating: 'ui.mascot.celebrating',
  snuggled: 'ui.mascot.snuggled',
  'saving-a-seat': 'ui.mascot.savingASeat',
  napping: 'ui.mascot.napping',
} as const;

/**
 * Bao and Bun (MOB-05, animated in MOB-31, D32). One accessibility element whose label describes
 * the state. Bao is always the viewer (orange blush), Bun their partner (sky blush).
 *
 * Every mood loops its board animation (breathing, blinking, steam, bounce, hearts, z's) on the UI
 * thread, see `mascot/`. The still pose is shown with Reduce Motion, below the face size (40 pt:
 * banner and strip icons) and with `still`.
 */
export function Mascot({
  mood,
  size = 120,
  partnerName,
  awake = 'you',
  accessibilityLabel,
  still = false,
  testID,
}: Props) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation();
  const dimension = Math.max(size, MASCOT_MIN_SIZE);
  const partner = partnerName?.trim() || t('ui.mascot.partnerFallback');
  const label =
    accessibilityLabel ??
    (mood === 'waiting'
      ? t(awake === 'you' ? 'ui.mascot.waitingPartner' : 'ui.mascot.waitingYou', { partner })
      : t(moodKey[mood], { partner }));

  const showFace = dimension >= MASCOT_FACE_MIN_SIZE;
  const animated = showFace && !still && !reducedMotion;

  return (
    <RigRoot animated={animated} size={dimension} label={label} testID={testID}>
      <MoodScene mood={mood} awake={awake} showFace={showFace} colors={colors} />
    </RigRoot>
  );
}
