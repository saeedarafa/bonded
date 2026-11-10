// QA-07: which screen is checked how. Every screen id in qa/release/screen-requirements.csv must
// be either a CASE below (rendered through the real router and checked) or in NOT_RENDERED with a
// reason. coverage.test.ts fails when a new id appears in the CSV, or when a screen that the
// source marks as built (testID "<id>-screen") has no case, or when a placeholder gets built.
import { couple, ME, MY_ANSWER, PARTNER, PARTNER_ANSWER, time, type World } from './world';

export type Case = {
  /** Screen id from design-handoff/screens.json. */
  id: string;
  /** Short state name: the screen's main states get one case each. */
  state: string;
  url: string;
  /** Edit the fake server for this state (world starts as Maya + Sam paired, nobody answered). */
  world?: (w: World) => void;
  /** Client-side state (stores) for this case; runs after the stores are reset. */
  client?: () => void;
  /** testID that proves the state rendered (default `<id>-screen`). */
  expect?: string;
  /** Structure snapshot in light, dark and 200% (key screens); the rest are checked in light + 200%. */
  snapshot?: boolean;
  /** Reveal rule applies: the partner's answer must not be anywhere in the tree. */
  beforeReveal?: boolean;
  /** Free couple on a premium pack: no locked question text anywhere (MOB-20). */
  lockedPack?: boolean;
  /** Documented exception to "every screen has a heading". */
  noHeading?: string;
};

const signedOut = (w: World) => {
  w.user = null;
  w.couple = null;
};
const solo = (w: World) => {
  w.couple = couple([ME]);
};
const answered = (...who: string[]) => (w: World) => {
  w.today!.answeredBy = who;
  if (who.includes(ME)) w.answers[ME] = MY_ANSWER;
  if (who.includes(PARTNER)) w.answers[PARTNER] = PARTNER_ANSWER;
};
const premium = (w: World) => {
  w.entitlements = [{ user_id: ME, is_active: true, expires_at: time.iso(30) }];
};

/** Late-bound store helpers (the stores are app modules; import them lazily inside a test). */
/* eslint-disable @typescript-eslint/no-require-imports */
const pendingInvite = () =>
  require('@/features/auth/pendingInvite').usePendingInvite.getState().set({
    code: '4827',
    token: 'invite-token-123456',
    inviterName: 'Maya',
  });
const revealed = () => require('@/lib/drafts').useDrafts.getState().markRevealed('cq-today');
/* eslint-enable @typescript-eslint/no-require-imports */

export const CASES: Case[] = [
  // ---- onboarding (signed out) ------------------------------------------------------------
  { id: '01', state: 'default', url: '/welcome', world: signedOut, snapshot: true },
  { id: '02', state: 'default', url: '/story/1', world: signedOut },
  { id: '03', state: 'default', url: '/story/2', world: signedOut },
  { id: '04', state: 'default', url: '/story/3', world: signedOut },
  { id: '05', state: 'default', url: '/quiz/stage', world: signedOut },
  { id: '06', state: 'default', url: '/quiz/goals', world: signedOut },
  { id: '07', state: 'default', url: '/quiz/names', world: signedOut },
  { id: '47', state: 'default', url: '/quiz/dates', world: signedOut },
  { id: '08', state: 'default', url: '/sign-in', world: signedOut, snapshot: true },
  // ---- joining (signed out, then signed in without a couple) ------------------------------
  { id: 'J2', state: 'link', url: '/join/welcome', world: signedOut, client: pendingInvite },
  { id: 'J3', state: 'default', url: '/join/code', world: signedOut, snapshot: true },
  { id: 'J4', state: 'default', url: '/join/sign-in', world: signedOut, client: pendingInvite },
  {
    id: 'J5',
    state: 'default',
    url: '/join/name',
    world: (w) => (w.couple = null),
    client: pendingInvite,
  },
  { id: 'J10', state: 'default', url: '/join/full', world: signedOut },
  // ---- pairing (signed in) -----------------------------------------------------------------
  { id: '10', state: 'solo', url: '/invite', world: solo, snapshot: true },
  { id: '11', state: 'solo', url: '/waiting', world: solo },
  { id: '12', state: 'solo', url: '/join', world: solo },
  { id: '13', state: 'paired', url: '/paired' },
  { id: '09', state: 'default', url: '/reminders' },
  { id: 'J6', state: 'default', url: '/join/reminders' },
  { id: 'J8', state: 'partner-plan', url: '/join/done', world: premium },
  // ---- daily loop -----------------------------------------------------------------------------
  { id: '18', state: 'your-turn', url: '/today', snapshot: true, beforeReveal: true },
  {
    id: '18',
    state: 'partner-answered',
    url: '/today',
    world: answered(PARTNER),
    expect: '18-screen',
    beforeReveal: true,
  },
  { id: '23', state: 'waiting', url: '/today', world: answered(ME), beforeReveal: true },
  {
    id: '24',
    state: 'both-answered',
    url: '/today',
    world: answered(ME, PARTNER),
    beforeReveal: true,
  },
  {
    id: '28',
    state: 'napping',
    url: '/today',
    world: (w) => {
      w.streak = { ...w.streak, current: 0, last_completed_on: time.day(-2), saver_available: true };
    },
  },
  { id: '19', state: 'default', url: '/today/answer', snapshot: true, beforeReveal: true },
  {
    id: 'J7',
    state: 'first-question',
    url: '/today/answer?first=1',
    world: answered(PARTNER),
    beforeReveal: true,
  },
  {
    id: '20',
    state: 'sealed',
    url: '/today/reveal',
    world: answered(ME, PARTNER),
    snapshot: true,
    beforeReveal: true,
  },
  {
    id: '21',
    state: 'revealed',
    url: '/today/revealed',
    world: answered(ME, PARTNER),
    client: revealed,
    snapshot: true,
  },
  {
    id: '22',
    state: 'messages',
    url: '/today/thread',
    world: (w) => {
      answered(ME, PARTNER)(w);
      w.thread = [
        { id: 'm1', clientId: 'c1', userId: PARTNER, body: 'FIXTURE-MSG-1 that made me laugh', createdAt: time.iso(-0.05) },
        { id: 'm2', clientId: 'c2', userId: ME, body: 'FIXTURE-MSG-2 same here', createdAt: time.iso(-0.04) },
      ];
    },
    client: revealed,
    snapshot: true,
  },
  { id: '25', state: 'milestone-7', url: '/milestone/7' },
  // ---- history ------------------------------------------------------------------------------
  {
    id: '29',
    state: 'list',
    url: '/history',
    snapshot: true,
    world: (w) => {
      w.firstDay = time.day(-3);
      w.historyDays = [-3, -2, -1].map((d) => ({ assignedFor: time.day(d), answerCount: 2 }));
      w.historyRows = [-1, -2, -3].map((d) => ({
        id: `cq${d}`,
        source: 'daily',
        assignedFor: time.day(d),
        createdAt: time.iso(d),
        answerCount: 2,
        question: `History question ${-d}?`,
        hearts: 1,
        replies: 2,
      }));
    },
  },
  { id: '53', state: 'empty', url: '/history' },
  {
    id: '30',
    state: 'answered-both',
    url: '/history/cq-1',
    world: (w) => {
      w.historyDetail = {
        id: 'cq-1',
        source: 'daily',
        assignedFor: time.day(-1),
        createdAt: time.iso(-1),
        answerCount: 2,
        question: 'History question 1?',
        answeredBy: [ME, PARTNER],
        replies: 0,
      };
    },
  },
  // ---- packs (D43: first question free; MOB-20: locked text never shown) -------------------
  { id: '32', state: 'free', url: '/packs', snapshot: true },
  { id: '32', state: 'premium', url: '/packs', world: premium, expect: '32-screen' },
  { id: '33', state: 'free-locked', url: '/packs/p-premium', snapshot: true, lockedPack: true },
  { id: '33', state: 'premium', url: '/packs/p-premium', world: premium, expect: '33-screen' },
  { id: '33', state: 'free-pack', url: '/packs/p-free', expect: '33-screen' },
  // ---- premium and offers --------------------------------------------------------------------
  { id: '16', state: 'no-store', url: '/paywall', snapshot: true },
  { id: '34', state: 'no-store', url: '/paywall?from=pack&pack=Future%20Us&packId=p-premium' },
  { id: '35', state: 'both-premium', url: '/success', world: premium },
  {
    id: '14',
    state: 'eligible',
    url: '/gift',
    world: (w) => (w.offers.intro = { eligible: true, expiresAt: time.iso(1) }),
  },
  {
    id: '15',
    state: 'opened',
    url: '/gift/opened',
    world: (w) => (w.offers.intro = { eligible: true, expiresAt: time.iso(1) }),
  },
  {
    id: '36',
    state: 'eligible',
    url: '/winback',
    world: (w) => (w.offers.winback = { eligible: true, expiresAt: time.iso(1) }),
  },
  // ---- us ----------------------------------------------------------------------------------
  {
    id: '52',
    state: 'some-earned',
    url: '/us/badges',
    world: (w) => {
      w.awards = [1, 3].map((n) => ({
        id: `aw${n}`,
        badge_slug: `streak-${n}`,
        couple_id: 'couple-1',
        user_id: null,
        awarded_at: time.iso(-n),
      }));
    },
  },
  // ---- dev ---------------------------------------------------------------------------------
  { id: '54', state: 'gallery', url: '/dev/gallery', expect: 'gallery' },
];

/** Placeholders: still PlaceholderScreen today. coverage.test.ts fails the day one gets built. */
export const PLACEHOLDERS: Record<string, string> = {
  '27': '/us/feedback',
  '31': '/history/recap',
  '40': '/us',
  '41': '/us/notifications',
  '42': '/us/couple',
  '43': '/us/delete',
  '58': '/partner-left',
};

/** CSV ids that are not an app screen state this suite can render, with the reason. */
export const NOT_RENDERED: Record<string, string> = {
  J1: 'invite arrives in a messenger (outside the app)',
  J9: 'wrong code: an error state of J3 after a failed accept_invite; covered by Maestro joiner-errors',
  '56': 'invite expired: an error state of J3/12 after accept_invite; covered by Maestro joiner-errors',
  '17': 'paywall exit sheet: opens on close of 16 with a live offering; needs RevenueCat interaction',
  '57': 'payment failed sheet: opens after a failed purchase; qa/app/purchases.test.tsx covers it',
  '26': 'monthly check-in: P2, later; no route yet',
  '37': 'lock screen notifications: OS surface; qa/fixtures/push-payloads.json + device runs',
  '38': 'home widgets: native extension, not in the RN tree',
  '39': 'notification rules: server behaviour (BE-08/BE-19), contract tests',
  '48': 'our milestones: P2, later; no route yet',
  '49': 'personal milestone: P2, later; no route yet',
  '50': 'celebrate your partner: P2, later; no route yet',
  '51': 'anniversary day: P2, later; no route yet',
  '52b': 'badge unlocked sheet: shown over 18/52 when an award is new; BadgeUnlockedSheet in its own tests',
  '55': 'offline banner: needs NetInfo offline; covered in src tests, add a case when MOB-14 lands a route state',
  '60': 'store screenshots (release asset)',
  '61': 'store screenshots (release asset)',
  '62': 'store listing graphics (release asset)',
  '63': 'Today dark = 18 in dark mode (snapshot)',
  '64': 'Hold to reveal dark = 20 in dark mode (snapshot)',
  '65': 'Thread dark = 22 in dark mode (snapshot)',
  '66': 'Paywall dark = 16 in dark mode (snapshot)',
};
