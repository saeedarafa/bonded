// QA-07: which screen is checked how. Every screen id in qa/release/screen-requirements.csv must
// be either a CASE below (rendered through the real router and checked) or in NOT_RENDERED with a
// reason. coverage.test.ts fails when a new id appears in the CSV, or when a screen that the
// source marks as built (testID "<id>-screen") has no case, or when a placeholder gets built.
import {
  couple,
  ME,
  MY_ANSWER,
  PACK_CQ,
  packQuestion,
  PARTNER,
  PARTNER_ANSWER,
  time,
  type World,
} from './world';

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
  /**
   * Interaction that puts the screen in this state (type a word, open a sheet), run after the
   * screen is up; then `ready` (if given) must appear before the checks run.
   */
  act?: () => Promise<void> | void;
  /** testID that proves `act` reached the state. */
  ready?: string;
  /** Structure snapshot in light, dark and 200% (key screens); the rest are checked in light + 200%. */
  snapshot?: boolean;
  /** Reveal rule applies: the partner's answer must not be anywhere in the tree. */
  beforeReveal?: boolean;
  /**
   * D13 (MOB-49): the screen must not request any answer or message text (getRevealedQuestion,
   * getLastMessage), not even mine. A pack question before the hold.
   */
  noAnswerText?: boolean;
  /** MOB-50 (D08): the ended archive is closed (30 days over): the app must not even ask for it. */
  noArchiveReads?: boolean;
  /** testIDs that must not be in the tree in this state (reveal rule, read-only archive). */
  absent?: string[];
  /** testIDs that must be in the tree in this state, besides `expect`. */
  present?: string[];
  /** Free couple on a pack (D51: every pack): no locked question text anywhere (MOB-20). */
  lockedPack?: boolean;
  /** Documented exception to "every screen has a heading". */
  noHeading?: string;
  /**
   * Findings that are not bugs on this case (finding substring -> reason). For the gallery (it
   * shows components out of the screen that gives them meaning) and for design decisions the
   * heuristic cannot see (each names the decision; a product bug goes in KNOWN instead).
   */
  allow?: Record<string, string>;
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
/** QA-30: this week on 31 (Mon both answered, today nobody yet) with Sam's answer most loved. */
const LOVED_ID = 'a-loved';
const LOVED = { id: LOVED_ID, userId: PARTNER, createdAt: time.iso(-1), hearts: 2 };
const recapWeek = (w: World) => {
  w.historyDays = [{ assignedFor: time.day(-1), answerCount: 2 }];
  w.recap = { daysTogether: 1, replies: 3, reactions: 2, mostLovedAnswerId: LOVED_ID };
  w.answerBodies = { [LOVED_ID]: PARTNER_ANSWER };
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
const packRevealed = () => require('@/lib/drafts').useDrafts.getState().markRevealed(PACK_CQ);
/** QA-34 (D50): what the person told 05/06/07 before the screen (fixture names only). */
const onboardingAs =
  (state: { stage?: string; goals?: string[]; displayName?: string; partnerName?: string }) =>
  () =>
    require('@/features/onboarding/store').useOnboarding.setState(state);
/** QA-34 (MOB-61): what T1 and N kept on the phone before sign-in (`usePendingSetup`). */
const pendingSetup =
  (state: { firstAnswer?: string; ritualTime?: string; reminders?: 'on' | 'off' }) => () => {
    const store = require('@/features/onboarding/pendingSetup').usePendingSetup;
    if (state.firstAnswer) store.getState().setFirstAnswer(state.firstAnswer);
    if (state.ritualTime) store.getState().setRitual(state.ritualTime, state.reminders ?? 'off');
  };
const both =
  (...fns: (() => void)[]) =>
  () =>
    fns.forEach((f) => f());
/** The `couple_stage` values (05 tiles, 02 versions). */
const STAGE_IDS = ['dating', 'living_together', 'engaged_married', 'long_distance'];
const ui = () => require('expo-router/testing-library') as typeof import('expo-router/testing-library');
/** Press a control by testID (inside act, so the state update lands before the checks). */
const press = (testID: string) => async () => {
  const { act, fireEvent, screen } = ui();
  await act(async () => fireEvent.press(screen.getByTestId(testID)));
};
/** Type into a field, then optionally press a control. */
const typeThen = (field: string, text: string, then?: string) => async () => {
  const { act, fireEvent, screen } = ui();
  await act(async () => fireEvent.changeText(screen.getByTestId(field), text));
  if (then) await press(then)();
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Maya's partner left (58): no active couple, an ended couple with Sam not yet seen here. */
const partnerLeft = (w: World) => {
  w.couple = null;
  w.endedCouple = {
    id: 'couple-ended',
    ended_at: time.iso(-0.5),
    paired_at: time.iso(-40),
    couple_members: [
      { user_id: ME, left_at: null },
      { user_id: PARTNER, left_at: time.iso(-0.5) },
    ],
  };
};

/**
 * MOB-50 (D08, D09): my couple with `partner` ended `daysAgo` days ago; its History stays readable
 * for 30 days. Archive: cq-e1 both answered (2 replies), cq-e2 only I answered, cq-e3 only my
 * partner answered (RLS hides their row from me; the app must not offer it or ask for its text).
 */
const endedArchive =
  (daysAgo: number, { active = false, partner = PARTNER }: { active?: boolean; partner?: string } = {}) =>
  (w: World) => {
    if (!active) w.couple = null;
    w.endedCouple = {
      id: 'couple-ended',
      ended_at: time.iso(-daysAgo),
      paired_at: time.iso(-90),
      ended_by: partner,
      ended_reason: 'unpaired',
      couple_members: [
        { user_id: ME, left_at: time.iso(-daysAgo) },
        { user_id: partner, left_at: time.iso(-daysAgo) },
      ],
    };
    const row = (n: number, answeredBy: string[], replies = 0) => ({
      id: `cq-e${n}`,
      source: 'daily',
      assignedFor: time.day(-daysAgo - n),
      createdAt: time.iso(-daysAgo - n),
      question: `Ended question ${n}?`,
      answeredBy,
      replies,
    });
    w.endedRows = [row(1, [ME, partner], 2), row(2, [ME]), row(3, [partner])];
    w.thread = [
      { id: 'm1', clientId: 'c1', userId: partner, body: 'FIXTURE-MSG-1 archived reply', createdAt: time.iso(-daysAgo - 1) },
      { id: 'm2', clientId: 'c2', userId: ME, body: 'FIXTURE-MSG-2 archived reply', createdAt: time.iso(-daysAgo - 1) },
    ];
  };
/** No composer, no answer button, no reactions in the archive (read-only). */
const READ_ONLY = ['22-composer', '30-open-thread', '30-thread-card', '19-input', '21-their-reaction'];

export const CASES: Case[] = [
  // ---- onboarding (signed out) ------------------------------------------------------------
  { id: '01', state: 'default', url: '/welcome', world: signedOut, snapshot: true },
  // QA-34 (MOB-60, D50): order 01 -> 05 -> 07 -> 02 -> 03 -> 04 -> 06 -> (47) -> 08. 02 has four
  // versions by the stage from 05 (living together when none); the names from 07 fill 02/03/04.
  {
    id: '02',
    state: 'default',
    url: '/story/1',
    world: signedOut,
    present: ['02-living_together', '02-body', '02-dots'],
    absent: ['02-dating', '02-engaged_married', '02-long_distance', '02-progress'],
  },
  ...STAGE_IDS.map(
    (stage): Case => ({
      id: '02',
      state: stage,
      url: '/story/1',
      world: signedOut,
      client: onboardingAs({ stage, partnerName: 'Ari', displayName: 'Noor' }),
      present: [`02-${stage}`, '02-body'],
      absent: STAGE_IDS.filter((s) => s !== stage).map((s) => `02-${s}`),
    }),
  ),
  {
    id: '03',
    state: 'default',
    url: '/story/2',
    world: signedOut,
    client: onboardingAs({ partnerName: 'Ari' }),
    present: ['03-private', '03-title', '03-progress', '03-this_week'],
  },
  {
    id: '04',
    state: 'default',
    url: '/story/3',
    world: signedOut,
    client: onboardingAs({ partnerName: 'Ari', displayName: 'Noor' }),
    snapshot: true,
    present: [
      '04-question',
      '04-partner-card',
      '04-my-card',
      '04-reaction-0',
      '04-reaction-1',
      '04-reaction-2',
      '04-psychology',
    ],
    absent: ['04-progress'],
  },
  {
    id: '05',
    state: 'default',
    url: '/quiz/stage',
    world: signedOut,
    present: ['05-progress'],
  },
  // The tile check marks (`05-<stage>-check`) are hidden from screen readers, so present/absent
  // (which skip hidden elements) cannot see them: the D50 describe in screens.test.tsx checks them.
  {
    id: '05',
    state: 'picked',
    url: '/quiz/stage',
    world: signedOut,
    client: onboardingAs({ stage: 'long_distance' }),
  },
  {
    id: '06',
    state: 'default',
    url: '/quiz/goals',
    world: signedOut,
    present: ['06-progress'],
    absent: ['06-summary'],
  },
  {
    id: '06',
    state: 'picked',
    url: '/quiz/goals',
    world: signedOut,
    client: onboardingAs({ goals: ['learning', 'deep_talks', 'laughing'] }),
    present: ['06-summary'],
  },
  { id: '07', state: 'default', url: '/quiz/names', world: signedOut, present: ['07-progress'] },
  { id: '47', state: 'default', url: '/quiz/dates', world: signedOut, absent: ['47-progress'] },
  // ---- D50 plan (MOB-61): T1 -> N -> L -> P2, signed out, before 08 ------------------------
  // T1 Try it: the day-1 question answered on the phone; "Almost there" bar instead of n/4.
  {
    id: 'T1',
    state: 'default',
    url: '/plan/first-question',
    world: signedOut,
    client: onboardingAs({ partnerName: 'Ari', displayName: 'Noor' }),
    snapshot: true,
    present: ['T1-progress', 'T1-chip', 'T1-question', 'T1-field', 'T1-private', 'T1-submit', 'T1-note'],
    absent: ['T1-field-error'],
  },
  {
    id: 'T1',
    state: 'empty',
    url: '/plan/first-question',
    world: signedOut,
    client: onboardingAs({ partnerName: 'Ari' }),
    act: press('T1-submit'),
    ready: 'T1-field-error',
  },
  // Back from N, or after an app kill: the kept answer is in the field (truncation at 200% checks
  // MY_ANSWER, and the console capture fails on a logged FIXTURE- text).
  {
    id: 'T1',
    state: 'kept',
    url: '/plan/first-question',
    world: signedOut,
    client: both(onboardingAs({ partnerName: 'Ari' }), pendingSetup({ firstAnswer: MY_ANSWER })),
    absent: ['T1-field-error'],
  },
  // N Your daily moment: three times (21:00 picked) + "Pick another time"; both buttons go on.
  {
    id: 'N',
    state: 'default',
    url: '/plan/moment',
    world: signedOut,
    client: onboardingAs({ partnerName: 'Ari' }),
    snapshot: true,
    present: ['N-times', 'N-time-morning', 'N-time-lunch', 'N-time-evening', 'N-other', 'N-accept', 'N-decline'],
    absent: ['N-time-other', 'N-picker', 'N-progress'],
  },
  {
    id: 'N',
    state: 'picker',
    url: '/plan/moment',
    world: signedOut,
    act: press('N-other'),
    ready: 'N-picker',
  },
  // A time that is not one of the tiles (kept from an earlier visit) shows as its own row.
  {
    id: 'N',
    state: 'other-time',
    url: '/plan/moment',
    world: signedOut,
    client: pendingSetup({ ritualTime: '07:15', reminders: 'off' }),
    present: ['N-time-other'],
  },
  // L Building your plan: renderRouter's fake clock is not advanced past ~80 ms, so L stays up
  // (it moves on to P2 after 4 s by itself; mobile's plan.test.tsx covers the timing).
  {
    id: 'L',
    state: 'declined',
    url: '/plan/building',
    world: signedOut,
    client: both(
      onboardingAs({ stage: 'dating', goals: ['deep_talks'], displayName: 'Noor', partnerName: 'Ari' }),
      pendingSetup({ ritualTime: '21:00', reminders: 'off' }),
    ),
    present: ['L-title', 'L-progress', 'L-checklist', 'L-step-0', 'L-step-1', 'L-step-2', 'L-step-3', 'L-closer'],
  },
  // P2 Your plan: one chart element for a screen reader, two findings with sources, Start.
  {
    id: 'P2',
    state: 'default',
    url: '/plan/yours',
    world: signedOut,
    client: both(
      onboardingAs({ displayName: 'Noor', partnerName: 'Ari' }),
      pendingSetup({ ritualTime: '12:30', reminders: 'on' }),
    ),
    snapshot: true,
    present: [
      'P2-progress',
      'P2-title',
      'P2-chart',
      'P2-chart-source',
      'P2-finding-personal',
      'P2-finding-warm',
      'P2-finding-personal-source',
      'P2-finding-warm-source',
      'P2-summary',
      'P2-start',
    ],
  },
  // TODO(QA-34, MOB-62): P3 soft trial paywall cases (default, yearly picked, × -> 17) once the
  // screen and its testIDs land; until then P3 is neither built nor in the CSV.
  // D50: the quiz ends at 06 (4/4), so 08 shows no progress any more (snapshots re-accepted).
  {
    id: '08',
    state: 'default',
    url: '/sign-in',
    world: signedOut,
    snapshot: true,
    absent: ['08-progress'],
  },
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
    // D45 (MOB-53): "+" opens the full emoji picker (quick row, search, categories, grid).
    id: '21',
    state: 'picker',
    url: '/today/revealed',
    world: answered(ME, PARTNER),
    client: revealed,
    act: press('21-react-more'),
    ready: '21-react-picker',
    present: ['21-react-picker-search', '21-react-picker-quick-2764', '21-react-picker-grid'],
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
  // ---- a started pack question in the answer flow (MOB-49, QA-22) ------------------------------
  // 33 opens /history/<id>/answer; 30 routes the row by state. Same screens as today's 19/20/21.
  {
    id: '19',
    state: 'pack',
    url: `/history/${PACK_CQ}/answer`,
    world: (w) => packQuestion(w, []),
    snapshot: true,
    beforeReveal: true,
    noAnswerText: true,
  },
  {
    id: '19',
    state: 'pack-partner-answered',
    url: `/history/${PACK_CQ}/answer`,
    world: (w) => packQuestion(w, [PARTNER]),
    expect: '19-screen',
    beforeReveal: true,
    noAnswerText: true,
  },
  // 30 for a pack question I've not answered hands over to 19.
  {
    id: '19',
    state: 'pack-from-30',
    url: `/history/${PACK_CQ}`,
    world: (w) => packQuestion(w, []),
    expect: '19-screen',
    beforeReveal: true,
    noAnswerText: true,
  },
  // Answered, partner not yet: no deadline, so "waiting", not "missed"; no text at all (D13).
  {
    id: '30',
    state: 'pack-partner-waiting',
    url: `/history/${PACK_CQ}`,
    world: (w) => packQuestion(w, [ME]),
    expect: '30-partner-waiting',
    snapshot: true,
    beforeReveal: true,
    noAnswerText: true,
  },
  // 19 for a pack question I've already answered hands over to 30.
  {
    id: '30',
    state: 'pack-answered-again',
    url: `/history/${PACK_CQ}/answer`,
    world: (w) => packQuestion(w, [ME]),
    expect: '30-partner-waiting',
    beforeReveal: true,
    noAnswerText: true,
  },
  {
    id: '20',
    state: 'pack-sealed',
    url: `/history/${PACK_CQ}/reveal`,
    world: (w) => packQuestion(w, [ME, PARTNER]),
    expect: '20-screen',
    snapshot: true,
    beforeReveal: true,
    noAnswerText: true,
  },
  // 30 sends a pack question both answered (not yet revealed on this phone) to the hold first.
  {
    id: '20',
    state: 'pack-from-30',
    url: `/history/${PACK_CQ}`,
    world: (w) => packQuestion(w, [ME, PARTNER]),
    expect: '20-screen',
    beforeReveal: true,
    noAnswerText: true,
  },
  {
    id: '21',
    state: 'pack-revealed',
    url: `/history/${PACK_CQ}/revealed`,
    world: (w) => packQuestion(w, [ME, PARTNER]),
    client: packRevealed,
    expect: '21-screen',
    snapshot: true,
  },
  // After the hold, 30 is the archive view of the pack question (both answers).
  {
    id: '30',
    state: 'pack-revealed',
    url: `/history/${PACK_CQ}`,
    world: (w) => packQuestion(w, [ME, PARTNER]),
    client: packRevealed,
    expect: '30-partner',
  },
  // ---- ended couple History (MOB-50, D08/D09; GAPS: no board, reuses 29/30) ------------------
  {
    id: '29',
    state: 'ended-card',
    url: '/history',
    // A new couple, and the old bond with Alex ended 29 days ago: the door is still open.
    world: (w) => {
      endedArchive(29, { active: true, partner: 'u-alex' })(w);
      w.formerName = 'Alex';
    },
    expect: '29-ended',
    snapshot: true,
  },
  {
    id: '29',
    state: 'ended-card-closed',
    url: '/history',
    world: endedArchive(31, { active: true, partner: 'u-alex' }),
    expect: '29-screen',
    absent: ['29-ended'],
  },
  {
    id: '29',
    state: 'ended-list',
    url: '/ended',
    world: endedArchive(2),
    expect: 'ended-row-cq-e1',
    snapshot: true,
    beforeReveal: true,
    noAnswerText: true,
    // cq-e3: only Sam answered; I can't read or answer it any more, so it is not listed.
    absent: ['ended-row-cq-e3', ...READ_ONLY],
  },
  {
    id: '29',
    state: 'ended-empty',
    url: '/ended',
    world: (w) => {
      endedArchive(2)(w);
      w.endedRows = w.endedRows.filter((r) => !r.answeredBy.includes(ME));
    },
    expect: 'ended-empty',
    beforeReveal: true,
    noAnswerText: true,
  },
  {
    id: '29',
    state: 'ended-closed',
    url: '/ended',
    world: endedArchive(31),
    expect: 'ended-closed',
    beforeReveal: true,
    noAnswerText: true,
    noArchiveReads: true,
  },
  {
    id: '30',
    state: 'ended-both',
    url: '/ended/cq-e1',
    world: endedArchive(2),
    expect: 'ended-q-partner',
    // The bubbles serialise with opacity=0: the Reanimated jest mock does not re-render after the
    // fade-in, and here the thread mounts last. Structure and labels are what this snapshot pins.
    snapshot: true,
    absent: READ_ONLY,
  },
  {
    id: '30',
    state: 'ended-only-mine',
    url: '/ended/cq-e2',
    world: endedArchive(2),
    expect: 'ended-q-only-mine',
    beforeReveal: true,
    absent: ['ended-q-partner', 'ended-q-thread', ...READ_ONLY],
  },
  {
    id: '30',
    state: 'ended-partner-only',
    url: '/ended/cq-e3',
    world: endedArchive(2),
    expect: 'ended-q-unanswered',
    beforeReveal: true,
    noAnswerText: true,
    absent: ['ended-q-partner', 'ended-q-mine', 'ended-q-thread', ...READ_ONLY],
  },
  {
    id: '30',
    state: 'ended-closed',
    url: '/ended/cq-e1',
    world: endedArchive(31),
    expect: 'ended-q-closed',
    beforeReveal: true,
    noAnswerText: true,
    noArchiveReads: true,
  },
  // ---- weekly recap (MOB-21 part 2, D21, BE-14; QA-30) ----------------------------------------
  // NOW is Tuesday 2026-11-10, so the week is Mon 11-09 .. Sun 11-15.
  {
    id: '31',
    state: 'free',
    url: '/history/recap',
    world: recapWeek,
    expect: '31-premium',
    present: ['31-premium-cta', '31-days'],
    snapshot: true,
    beforeReveal: true,
    // Free: the server sends no answer id, so the app asks for no answer text at all.
    noAnswerText: true,
    absent: ['31-replies', '31-reactions', '31-loved', '31-loved-body'],
  },
  {
    id: '31',
    state: 'full',
    url: '/history/recap',
    // Premium; the most-loved answer is Sam's on Monday's daily question (both answered).
    world: (w) => {
      premium(w);
      recapWeek(w);
      w.lovedAnswer = { ...LOVED, coupleQuestionId: 'cq-mon', source: 'daily', assignedFor: time.day(-1) };
    },
    expect: '31-loved-body',
    present: ['31-replies', '31-reactions', '31-loved-by'],
    snapshot: true,
    absent: ['31-premium', '31-loved-hidden'],
  },
  {
    id: '31',
    state: 'loved-hidden',
    url: '/history/recap',
    // Premium; the most-loved answer is on a pack question this device has not held yet (D13):
    // its text must not even be requested (reveal rule).
    world: (w) => {
      premium(w);
      recapWeek(w);
      w.lovedAnswer = { ...LOVED, coupleQuestionId: PACK_CQ, source: 'pack', assignedFor: null };
    },
    expect: '31-loved-hidden',
    present: ['31-loved-open', '31-loved-by'],
    beforeReveal: true,
    noAnswerText: true,
    absent: ['31-loved-body', '31-premium'],
  },
  // ---- packs (D51: packs come with Premium; a free couple reads one sample question per pack,
  // keeps the questions it already started, and never gets locked question text: MOB-20) -----
  {
    id: '32',
    state: 'free',
    url: '/packs',
    snapshot: true,
    // No free tile: the first pack is featured as "New this week" (by slug, inside 32-featured).
    present: ['32-featured', '32-pack-getting-to-know', '32-pack-future-us', '32-intro'],
  },
  { id: '32', state: 'premium', url: '/packs', world: premium, expect: '32-screen' },
  {
    id: '33',
    state: 'free-locked',
    url: '/packs/p-premium',
    snapshot: true,
    lockedPack: true,
    // Read-only sample (no answer button), locked rows without text, Unlock opens 34.
    present: ['33-sample', '33-sample-question', '33-locked-2', '33-more', '33-unlock', '33-covers'],
    absent: ['33-question-1', '33-questions', '33-started'],
  },
  {
    id: '33',
    state: 'premium',
    url: '/packs/p-premium',
    world: premium,
    expect: '33-screen',
    present: ['33-questions', '33-question-1', '33-question-6'],
    absent: ['33-sample', '33-locked', '33-unlock'],
  },
  {
    id: '33',
    state: 'free-pack',
    url: '/packs/p-free',
    expect: '33-screen',
    // D51: `is_premium=false` opens nothing any more; the same sample + locked rows.
    lockedPack: true,
    present: ['33-sample', '33-locked-2', '33-locked-3', '33-unlock'],
    absent: ['33-question-1', '33-questions'],
  },
  {
    id: '33',
    state: 'free-started',
    url: '/packs/p-premium',
    // A free couple that started question 3 (under D43 or while Premium): it stays openable, the
    // sample is the first not-started question, everything else is locked. The started row and
    // the sample are the only question text (screens.test.tsx checks the rest stays hidden).
    world: (w) => (w.startedPackQuestions = { pq3: 'cq-pq3' }),
    expect: '33-started-3',
    present: ['33-sample', '33-started', '33-locked-2', '33-locked-4', '33-unlock'],
    absent: ['33-question-1', '33-questions', '33-locked-3'],
  },
  // ---- premium and offers --------------------------------------------------------------------
  { id: '16', state: 'no-store', url: '/paywall', snapshot: true },
  {
    id: '16',
    state: 'plans',
    url: '/paywall',
    // D52: a live `default` offering (opaque test prices), no trial on 16.
    world: (w) => (w.store = { trialEligible: false }),
    expect: '16-buy',
    present: ['16-title', '16-benefits', '16-restore', '16-close'],
    allow: {
      'premium-label: #16-plan-yearly "Best value':
        'D52 board: 16 has no Premium title any more; gold marks the best-value plan card, whose words say so ("Best value · save X%"); the screen sells Premium (CTA "Get Premium for both"), no badge. Asked the lead to confirm against D41 (QA-33)',
    },
  },
  {
    id: '17',
    state: 'get-premium',
    url: '/paywall',
    // × on 16 opens 17; not trial-eligible: the main button is "Get Premium" (back to 16's plans).
    world: (w) => (w.store = { trialEligible: false }),
    expect: '16-buy',
    act: press('16-close'),
    ready: '17-sheet',
    present: ['17-main', '17-leave', '17-subtitle'],
    allow: {
      'premium-label: #16-plan-yearly "Best value':
        'D52 board: 16 has no Premium title any more; gold marks the best-value plan card, whose words say so ("Best value · save X%"); the screen sells Premium (CTA "Get Premium for both"), no badge. Asked the lead to confirm against D41 (QA-33)',
    },
  },
  {
    id: '17',
    state: 'trial',
    url: '/paywall',
    // RevenueCat says this person still gets the yearly plan's store trial.
    world: (w) => (w.store = { trialEligible: true }),
    expect: '16-buy',
    act: press('16-close'),
    ready: '17-sheet',
    present: ['17-main', '17-leave'],
    allow: {
      'premium-label: #16-plan-yearly "Best value':
        'D52 board: 16 has no Premium title any more; gold marks the best-value plan card, whose words say so ("Best value · save X%"); the screen sells Premium (CTA "Get Premium for both"), no badge. Asked the lead to confirm against D41 (QA-33)',
    },
  },
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
  // ---- private feedback (MOB-23, D22; QA-31) -------------------------------------------------
  {
    id: '27',
    state: 'empty',
    url: '/us/feedback',
    present: ['27-title', '27-tags', '27-tag-partner_forgets', '27-body', '27-send', '27-note'],
    absent: ['27-count', '27-error'],
    snapshot: true,
  },
  {
    id: '27',
    state: 'picked',
    url: '/us/feedback',
    act: press('27-tag-partner_forgets'),
    ready: '27-count',
    expect: '27-screen',
  },
  {
    id: '27',
    state: 'nothing',
    url: '/us/feedback',
    act: press('27-send'),
    ready: '27-body-error',
    expect: '27-screen',
    absent: ['27-error'],
  },
  {
    id: '27',
    state: 'failed',
    url: '/us/feedback',
    world: (w) => (w.feedbackFails = 'NETWORK'),
    act: async () => {
      await press('27-tag-partner_forgets')();
      await press('27-send')();
    },
    ready: '27-error',
    expect: '27-screen',
  },
  // ---- settings (MOB-18) -------------------------------------------------------------------
  { id: '40', state: 'paired-free', url: '/us', snapshot: true },
  { id: '40', state: 'solo', url: '/us', world: solo, expect: '40-screen' },
  { id: '40', state: 'premium', url: '/us', world: premium, expect: '40-screen' },
  {
    id: '40',
    state: 'partner-premium',
    url: '/us',
    world: (w) => (w.entitlements = [{ user_id: PARTNER, is_active: true, expires_at: time.iso(30) }]),
    expect: '40-screen',
  },
  {
    id: '40',
    state: 'ritual-sheet',
    url: '/us',
    act: press('40-ritual'),
    ready: '40-ritual-sheet',
    expect: '40-screen',
  },
  {
    id: '40',
    state: 'sign-out-sheet',
    url: '/us',
    act: press('40-sign-out'),
    ready: '40-sign-out-confirm',
    expect: '40-screen',
  },
  { id: '41', state: 'granted', url: '/us/notifications', world: (w) => (w.permission = 'granted'), snapshot: true },
  {
    id: '41',
    state: 'permission-denied',
    url: '/us/notifications',
    world: (w) => (w.permission = 'denied'),
    expect: '41-permission-denied',
  },
  {
    id: '41',
    state: 'permission-undetermined',
    url: '/us/notifications',
    expect: '41-permission-undetermined',
  },
  {
    id: '41',
    state: 'load-error',
    url: '/us/notifications',
    world: (w) => (w.notificationPrefs = Object.assign(new Error('Could not load'), { kind: 'UNKNOWN' })),
    expect: '41-error',
  },
  {
    id: '41',
    state: 'quiet-sheet',
    url: '/us/notifications',
    world: (w) => (w.permission = 'granted'),
    act: press('41-quiet'),
    ready: '41-quiet-23:00-07:00',
    expect: '41-toggles',
  },
  { id: '42', state: 'paired', url: '/us/couple', snapshot: true },
  { id: '42', state: 'solo', url: '/us/couple', world: solo, expect: '42-solo' },
  {
    id: '42',
    state: 'unpair-sheet',
    url: '/us/couple',
    act: press('42-unpair'),
    ready: '42-unpair-confirm',
    expect: '42-unpair-card',
  },
  { id: '43', state: 'empty', url: '/us/delete', snapshot: true },
  {
    id: '43',
    state: 'typed-delete',
    url: '/us/delete',
    act: typeThen('43-input', 'DELETE'),
    expect: '43-screen',
  },
  {
    id: '43',
    state: 'wrong-word',
    url: '/us/delete',
    act: typeThen('43-input', 'delete', '43-confirm'),
    ready: '43-input-error',
    expect: '43-screen',
  },
  {
    id: '43',
    state: 'delete-failed',
    url: '/us/delete',
    world: (w) => (w.deleteFails = 'NETWORK'),
    act: typeThen('43-input', 'DELETE', '43-confirm'),
    ready: '43-error',
    expect: '43-screen',
  },
  { id: '58', state: 'unpaired', url: '/partner-left', world: partnerLeft, expect: '58-title', snapshot: true },
  {
    id: '58',
    state: 'account-deleted',
    url: '/partner-left',
    world: (w) => {
      partnerLeft(w);
      w.formerName = null;
    },
    expect: '58-title',
  },
  // MOB-50: once the 30 days are over, 58 no longer offers the archive.
  {
    id: '58',
    state: 'history-closed',
    url: '/partner-left',
    world: endedArchive(31),
    expect: '58-title',
    absent: ['58-history'],
  },
  // QA-32 (MOB-27): "Download your history" makes the PDF. Busy while the archive is read (the
  // caption says so), an error banner when it fails; no answer text in the tree or in any log.
  {
    id: '58',
    state: 'exporting',
    url: '/partner-left',
    world: (w) => {
      partnerLeft(w);
      w.exportResult = 'pending';
    },
    act: press('58-download'),
    ready: '58-download-caption',
    expect: '58-title',
    absent: ['58-download-error'],
  },
  {
    id: '58',
    state: 'export-failed',
    url: '/partner-left',
    world: (w) => {
      partnerLeft(w);
      w.exportResult = 'UNKNOWN';
    },
    act: press('58-download'),
    ready: '58-download-error',
    expect: '58-title',
    present: ['58-download'],
  },
  // The archive (with both answers' text) was read, then printing failed: the banner shows only
  // our copy, never the text or the native error.
  {
    id: '58',
    state: 'print-failed',
    url: '/partner-left',
    world: (w) => {
      endedArchive(5)(w);
      w.printFails = true;
    },
    act: press('58-download'),
    ready: '58-download-error',
    expect: '58-title',
    beforeReveal: true,
  },
  // The front door sends a partner-left account to 58 (not the onboarding story or SetupBond).
  { id: '58', state: 'front-door', url: '/', world: partnerLeft, expect: '58-title' },
  // ---- dev ---------------------------------------------------------------------------------
  {
    id: '54',
    state: 'gallery',
    url: '/dev/gallery',
    expect: 'gallery',
    allow: {
      'premium-label: <View> "Start free trial"':
        'paywall CTA out of context next to badges; 16 checks the real CTA',
      'premium-label: <View> "Best value':
        'PlanCard out of context next to badges; on 16 it is allowed per D52 (see 16 plans)',
    },
  },
];

/** Placeholders: still PlaceholderScreen today. coverage.test.ts fails the day one gets built. */
export const PLACEHOLDERS: Record<string, string> = {};

/** CSV ids that are not an app screen state this suite can render, with the reason. */
export const NOT_RENDERED: Record<string, string> = {
  J1: 'invite arrives in a messenger (outside the app)',
  J9: 'wrong code: an error state of J3 after a failed accept_invite; covered by Maestro joiner-errors',
  '56': 'invite expired: an error state of J3/12 after accept_invite; covered by Maestro joiner-errors',
  '57': 'payment failed sheet: opens after a failed purchase; qa/app/purchases.test.tsx covers it',
  '26': 'monthly check-in: a sheet over 18 Today (no route), once per 30 days from day 30 after the reveal; CheckInSheet tests in src/features/feedback cover it (testIDs 26-sheet, 26-face-1..5, 26-send, 26-skip); Maestro dismisses it with 26-skip',
  '37': 'lock screen notifications: OS surface; qa/fixtures/push-payloads.json + device runs',
  '38': 'home widgets: native extension, not in the RN tree',
  // M5 screens added by LEAD-05 (QA-26): not built yet. QA-29 moves the RN ones to CASES once built.
  '19b': 'write up to 2000 (Premium): not built yet (D46, MOB-54); case added in QA-29',
  '19c': 'record a voice answer (Premium): not built yet (D46, MOB-55); case added in QA-29',
  '19d': 'write near the free limit: not built yet (D46, MOB-54); case added in QA-29',
  '22b': 'thread voice message (Premium): not built yet (D46, MOB-56); case added in QA-29',
  '24b': 'little things button on Today: not built yet (D48, MOB-58); case added in QA-29',
  '24c': 'little things fan open: not built yet (D48, MOB-58); case added in QA-29',
  '24d': 'partner sent a little thing back: not built yet (D48, MOB-59); case added in QA-29',
  '38b': 'home widgets, your turn (Countdown + Partner answered): native extension, not in the RN tree (D47, MOB-57); reveal-rule check on device',
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
