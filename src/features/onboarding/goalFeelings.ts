import type { IconName } from '@/ui';

import { GOAL_ICONS } from './components';
import { GOALS, type Goal } from './store';

/** The three lines P3 shows when nothing was picked on 06 (keys under `premium.goalFeelings.general`). */
export const GENERAL_FEELINGS = ['closeness', 'laughter', 'curiosity'] as const;
export type GeneralFeeling = (typeof GENERAL_FEELINGS)[number];

/** P3 shows at most this many goal-feeling lines (PO 2026-11-12, MOB-75). */
export const MAX_FEELING_LINES = 3;

/**
 * One line on P3. `key` is the goal key (or `general.<feeling>`) and is what analytics may record;
 * `i18nKey` is the copy, and the copy itself never leaves the screen.
 */
export type FeelingLine = {
  key: Goal | `general.${GeneralFeeling}`;
  i18nKey: `premium.goalFeelings.${Goal}` | `premium.goalFeelings.general.${GeneralFeeling}`;
  icon: IconName;
};

/** The general lines' icons (06 has no tile for them; same icon family as the goal chips). */
const GENERAL_ICONS: Record<GeneralFeeling, IconName> = {
  closeness: 'heart',
  laughter: 'smile',
  curiosity: 'sparkle',
};

/**
 * P3's goal-feeling lines (MOB-75): the goals picked on 06 in the **06 board order** (`GOALS`), not
 * the order they were tapped, at most 3. Nothing picked (or only unknown keys from an older build):
 * the three general lines. Each line takes its goal's 06 chip icon. A new goal on 06 only needs its `premium.goalFeelings.<goal>` copy and
 * its 06 icon; this layout does not change.
 */
export function goalFeelingLines(picked: readonly string[]): FeelingLine[] {
  const goals = GOALS.filter((g) => picked.includes(g)).slice(0, MAX_FEELING_LINES);
  if (goals.length === 0) {
    return GENERAL_FEELINGS.map((f) => ({
      key: `general.${f}`,
      i18nKey: `premium.goalFeelings.general.${f}`,
      icon: GENERAL_ICONS[f],
    }));
  }
  return goals.map((g) => ({ key: g, i18nKey: `premium.goalFeelings.${g}`, icon: GOAL_ICONS[g] }));
}

/**
 * `paywall_viewed.goal_keys` on P3 (MOB-75, ANALYTICS §3.9): the goal keys whose lines showed, or
 * `['general']` for the general lines. Keys only, never the copy.
 */
export function feelingGoalKeys(lines: readonly FeelingLine[]): (Goal | 'general')[] {
  return lines.some((l) => l.key.startsWith('general.'))
    ? ['general']
    : lines.map((l) => l.key as Goal);
}
