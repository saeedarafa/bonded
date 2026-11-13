import { ONBOARDING_STEPS } from '@/features/onboarding/flow';
import type { EventName, EventProps, ScreenId } from '@/lib/analytics';

/**
 * Screen views (MOB-24, D54): the file route name only (`app/(tabs)/today/answer`), built from
 * expo-router segments, so a dynamic segment stays `[questionId]` and never carries its value.
 * The board id comes from design-handoff/screens.json.
 */
const BOARD_BY_ROUTE: Record<string, ScreenId> = {
  'app/(onboarding)/welcome': '01',
  'app/(onboarding)/quiz/stage': '05',
  'app/(onboarding)/quiz/names': '07',
  'app/(onboarding)/quiz/goals': '06',
  'app/(onboarding)/quiz/dates': '47',
  'app/(onboarding)/plan/first-question': 'T1',
  'app/(onboarding)/plan/moment': 'N',
  'app/(onboarding)/plan/building': 'L',
  'app/(onboarding)/plan/yours': 'P2',
  'app/(onboarding)/plan/trial': 'P3',
  'app/(auth)/sign-in': '08',
  'app/(pairing)/reminders': '09',
  'app/(pairing)/invite': '10',
  'app/(pairing)/waiting': '11',
  'app/(pairing)/join': '12',
  'app/(pairing)/paired': '13',
  'app/(pairing)/partner-left': '58',
  'app/join/welcome': 'J2',
  'app/join/code': 'J3',
  'app/join/sign-in': 'J4',
  'app/join/name': 'J5',
  'app/join/reminders': 'J6',
  'app/join/done': 'J8',
  'app/join/full': 'J10',
  'app/(offer)/gift': '14',
  'app/(offer)/gift/opened': '15',
  'app/(offer)/paywall': '16',
  'app/(offer)/success': '35',
  'app/(tabs)/today': '18',
  'app/(tabs)/today/answer': '19',
  'app/(tabs)/today/reveal': '20',
  'app/(tabs)/today/revealed': '21',
  'app/(tabs)/today/thread': '22',
  'app/milestone/[n]': '25',
  'app/(tabs)/history': '29',
  'app/(tabs)/history/[questionId]': '30',
  'app/(tabs)/history/[questionId]/answer': '19',
  'app/(tabs)/history/[questionId]/reveal': '20',
  'app/(tabs)/history/[questionId]/revealed': '21',
  'app/(tabs)/history/[questionId]/thread': '22',
  'app/(tabs)/history/recap': '31',
  'app/(tabs)/packs': '32',
  'app/(tabs)/packs/[packId]': '33',
  'app/(tabs)/us': '40',
  'app/(tabs)/us/notifications': '41',
  'app/(tabs)/us/couple': '42',
  'app/(tabs)/us/delete': '43',
  'app/(tabs)/us/feedback': '27',
  'app/(tabs)/us/badges': '52',
};

/** The story screens share `story/[step]`; their fixed paths tell 02 / 03 / 04 apart. */
const STORY_BOARD: Record<string, ScreenId> = {
  '/story/1': '02',
  '/story/2': '03',
  '/story/3': '04',
};

/** Onboarding board ids in the D50 order (ANALYTICS §3.2 `step`). */
const STEP_IDS = ['01', '05', '07', '02', '03', '04', '06', 'T1', 'N', 'L', 'P2', 'P3'] as const;
export type OnboardingStepId = (typeof STEP_IDS)[number];

export function routeName(segments: readonly string[]): string {
  return ['app', ...segments.filter((s) => s !== 'index')].join('/');
}

export function screenView(
  segments: readonly string[],
  pathname: string,
): EventProps<'screen_viewed'> {
  const screen = routeName(segments);
  const screenId = STORY_BOARD[pathname] ?? BOARD_BY_ROUTE[screen];
  return screenId ? { screen, screen_id: screenId } : { screen };
}

/** The board id of an onboarding step (`/quiz/stage` → `05`). */
export function onboardingStepId(step: string): OnboardingStepId | null {
  const index = (ONBOARDING_STEPS as readonly string[]).indexOf(step);
  return STEP_IDS[index] ?? null;
}

/** The onboarding step on screen (by its fixed path, flow.ts), or null. */
export function onboardingStep(
  pathname: string,
): { step: OnboardingStepId; step_index: number } | null {
  const index = (ONBOARDING_STEPS as readonly string[]).indexOf(pathname);
  const step = index >= 0 ? STEP_IDS[index] : undefined;
  return step ? { step, step_index: index } : null;
}

/** Catalogue "…_viewed" events with no properties that a board's screen view implies. */
export const VIEW_EVENTS: Partial<Record<ScreenId, EventName>> = {
  '10': 'pair_invite_viewed',
  '32': 'packs_viewed',
  '58': 'partner_left_viewed',
  '43': 'account_delete_started',
  '35': 'both_premium_viewed',
  P2: 'plan_viewed',
};

/** 25 `/milestone/7`: the number from the fixed route, nothing else. */
export function milestoneNumber(pathname: string): number | null {
  const m = /^\/milestone\/(\d{1,4})$/.exec(pathname);
  return m ? Number(m[1]) : null;
}
