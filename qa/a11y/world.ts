// QA-07: the fake "server" behind every screen in the a11y suite. One mutable object, reset before
// each case; each case in screens.ts describes its state by editing it. The API fakes in setup.ts
// read it at call time, so a screen sees exactly the rows RLS would give it (CONTRACTS §2).
//
// Text that must never reach the a11y tree before it may is distinctive, so a grep finds it:
//   FIXTURE-PARTNER-ANSWER   Sam's answer (reveal rule: only after both answered AND the hold)
//   FIXTURE-LOCKED-Q         premium pack question bodies a free couple may not read (MOB-20, D43)
export const ME = 'u-maya';
export const PARTNER = 'u-sam';

/** 2026-11-10 09:00 UTC, a Tuesday. Date is the only faked clock (see setup.ts). */
export const NOW = new Date('2026-11-10T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();
const day = (offsetDays: number) => iso(offsetDays).slice(0, 10);

export const PARTNER_ANSWER = 'FIXTURE-PARTNER-ANSWER sunsets on the balcony';
export const MY_ANSWER = 'FIXTURE-MY-ANSWER the long walk home';
export const LOCKED_Q = 'FIXTURE-LOCKED-Q';

type Member = { user_id: string; left_at: string | null };

export type World = {
  user: { userId: string } | null;
  accountTimes: { created_at: string; last_sign_in_at: string | null } | null;
  couple: Record<string, unknown> | null;
  profiles: { id: string; display_name: string; avatar_url: string | null }[];
  entitlements: { user_id: string; is_active: boolean; expires_at: string | null }[];
  offers: Record<string, { eligible: boolean; expiresAt: string | null }>;
  offerClocks: { kind: string; expiresAt: string }[];
  /** Who has answered today (ids only); text lives in `answers`. */
  today: { id: string; question: string; answeredBy: string[] } | null;
  answers: Record<string, string>;
  reactions: { id: string; userId: string; kind: string; on: string }[];
  streak: Record<string, unknown> | null;
  thread: { id: string; clientId: string; userId: string; body: string; createdAt: string }[];
  historyRows: Record<string, unknown>[];
  historyDays: Record<string, unknown>[];
  firstDay: string | null;
  historyDetail: Record<string, unknown> | null;
  awards: Record<string, unknown>[];
  packs: {
    id: string;
    slug: string;
    title: string;
    description: string;
    isPremium: boolean;
    icon: string | null;
    questions: { id: string; position: number; body: string }[];
  }[];
  openInvite: { code: string; expiresAt: string; acceptedAt: string | null } | null;
  pendingRequests: { requestId: string; requesterName: string; expiresAt: string }[];
  myRequest: { status: string; expiresAt: string } | null;
  /** Calls the suite did not fake: listed so a new api function shows up instead of hanging. */
  unfaked: string[];
};

export const members = (...ids: string[]): Member[] => ids.map((user_id) => ({ user_id, left_at: null }));

export const couple = (ids: string[], extra: Record<string, unknown> = {}) => ({
  id: 'couple-1',
  status: 'active',
  created_at: iso(-40),
  ended_at: null,
  paired_at: ids.length > 1 ? iso(-40) : null,
  partner_name: ids.length > 1 ? null : 'Sam',
  relationship_start_date: '2023-03-14',
  stage: 'dating',
  goals: ['talk'],
  timezone: 'UTC',
  couple_members: members(...ids),
  ...extra,
});

const PACKS: World['packs'] = [
  {
    id: 'p-free',
    slug: 'getting-to-know',
    title: 'Getting to know you',
    description: 'Small questions for every day.',
    isPremium: false,
    icon: 'getting-to-know',
    questions: [1, 2, 3].map((n) => ({ id: `fq${n}`, position: n, body: `Free pack question ${n}?` })),
  },
  {
    id: 'p-premium',
    slug: 'future-us',
    title: 'Future Us',
    description: 'Dreams, plans and the next ten years.',
    isPremium: true,
    icon: 'future-us',
    questions: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `pq${n}`,
      position: n,
      body: n === 1 ? 'Where do you see us in five years?' : `${LOCKED_Q}-${n} secret plans`,
    })),
  },
];

export function freshWorld(): World {
  return {
    user: { userId: ME },
    accountTimes: { created_at: '2026-01-01T10:00:00Z', last_sign_in_at: iso(-1) },
    couple: couple([ME, PARTNER]),
    profiles: [
      { id: ME, display_name: 'Maya', avatar_url: null },
      { id: PARTNER, display_name: 'Sam', avatar_url: null },
    ],
    entitlements: [],
    offers: {},
    offerClocks: [],
    today: { id: 'cq-today', question: 'What made you smile this week?', answeredBy: [] },
    answers: {},
    reactions: [],
    streak: {
      current: 6,
      longest: 9,
      last_completed_on: day(-1),
      completed_today: false,
      at_risk: false,
      saver_available: false,
    },
    thread: [],
    historyRows: [],
    historyDays: [],
    firstDay: null,
    historyDetail: null,
    awards: [],
    packs: structuredClone(PACKS),
    openInvite: null,
    pendingRequests: [],
    myRequest: null,
    unfaked: [],
  };
}

export const world: World = freshWorld();

export function resetWorld() {
  Object.assign(world, freshWorld());
}

/** Today's answers as RLS returns them: mine always; the partner's only once mine exists. */
function visibleAnswerers(): string[] {
  const by = world.today?.answeredBy ?? [];
  return by.includes(ME) ? by : by.filter((u) => u === ME);
}

export const time = { iso, day, DAY };

// ---- fakes, one object per api module (setup.ts swaps them in) -----------------------------

const ok = <T>(v: T) => Promise.resolve(v);

export const fakes: Record<string, Record<string, (...args: never[]) => unknown>> = {
  '@/features/auth/api': {
    subscribeToSession: ((listener: (u: World['user']) => void) => {
      listener(world.user);
      return () => undefined;
    }) as never,
    getAccountTimes: () => ok(world.accountTimes),
    isAppleSignInAvailable: () => ok(false),
    signOut: () => ok(undefined),
    sendEmailCode: () => ok(undefined),
    verifyEmailCode: () => ok(undefined),
  },
  '@/features/couple/api': {
    getActiveCouple: () => ok(world.couple),
    createCouple: () => ok('couple-1'),
    unpair: () => ok(undefined),
  },
  '@/features/profile/api': {
    getCoupleProfiles: () => ok(world.profiles),
    updateMyProfile: () => ok(undefined),
    deviceTimezone: () => 'UTC',
  },
  '@/features/premium/api': {
    getEntitlements: () => ok(world.entitlements),
    getOffer: ((kind: string) => ok(world.offers[kind] ?? { eligible: false, expiresAt: null })) as never,
    getOfferClocks: () => ok(world.offerClocks),
  },
  '@/features/daily/api': {
    getTodayQuestion: () =>
      world.today
        ? ok({
            id: world.today.id,
            question: world.today.question,
            answerCount: world.today.answeredBy.length,
            answers: visibleAnswerers().map((userId) => ({ userId, createdAt: iso(-0.1) })),
          })
        : Promise.reject(new Error('no question')),
    getRevealedQuestion: () =>
      ok({
        id: world.today?.id ?? 'cq-today',
        question: world.today?.question ?? '',
        answerCount: world.today?.answeredBy.length ?? 0,
        answers: visibleAnswerers().map((userId) => ({
          id: `a-${userId}`,
          userId,
          body: world.answers[userId] ?? '',
          createdAt: iso(-0.1),
          reactions: world.reactions
            .filter((r) => r.on === userId)
            .map(({ id, userId: by, kind }) => ({ id, userId: by, kind })),
        })),
      }),
    getStreak: () => ok(world.streak),
    claimStreakSaver: () => ok(world.streak),
    saveAnswer: () => ok(undefined),
    setAnswerReaction: () => ok(undefined),
    removeAnswerReaction: () => ok(undefined),
    sendNudge: () => ok(undefined),
  },
  '@/features/history/api': {
    getHistoryMonth: () => ok(world.historyDays),
    getFirstHistoryDay: () => ok(world.firstDay),
    getHistoryPage: () => ok(world.historyRows),
    getHistoryDetail: () => ok(world.historyDetail),
    getLastMessage: () => ok(null),
  },
  '@/features/badges/api': {
    getBadgeCatalogue: () =>
      ok(
        [1, 3, 7, 14, 21, 30, 50, 100, 365].map((n) => ({
          slug: `streak-${n}`,
          kind: 'streak',
          owner: 'shared',
          threshold: n,
          title: `${n} days`,
          description: `Answer together ${n} days in a row.`,
          priority: 'P0',
          status: 'placeholder',
        })),
      ),
    getBadgeAwards: () => ok(world.awards),
  },
  '@/features/packs/api': {
    getPacks: () =>
      ok(
        world.packs.map(({ questions, ...p }) => ({ ...p, questionCount: questions.length })),
      ),
    getPack: ((id: string) => ok(world.packs.find((p) => p.id === id) ?? null)) as never,
    startPackQuestion: () => ok('cq-pack'),
  },
  '@/features/thread/api': {
    getThread: () => ok(world.thread.map((m) => ({ ...m, reactions: [] }))),
    getUnreadThreadCounts: () => ok({}),
    getUnreadCount: () => ok(0),
    markThreadRead: () => ok(undefined),
    sendMessage: () => ok(undefined),
  },
  '@/features/pairing/api': {
    createInvite: () => ok({ code: '4827', expiresAt: iso(2), token: 'tok' }),
    getOpenInvite: () => ok(world.openInvite),
    inviteLink: () => ok(null),
    invitePreview: () =>
      ok({ inviterName: 'Maya', inviterAvatarUrl: null, inviterAnsweredToday: false, expiresAt: iso(2) }),
    invitePreviewForLink: () =>
      ok({ inviterName: 'Maya', inviterAvatarUrl: null, inviterAnsweredToday: false, expiresAt: iso(2) }),
    acceptInvite: () => ok({ kind: 'paired', coupleId: 'couple-1' }),
    getPendingJoinRequests: () => ok(world.pendingRequests),
    getMyJoinRequest: () => ok(world.myRequest),
    approveJoin: () => ok('couple-1'),
    declineJoin: () => ok(undefined),
  },
  '@/features/keyDates/api': { upsertKeyDates: () => ok(undefined) },
  '@/features/push/api': {
    registerPushToken: () => ok(undefined),
    deletePushToken: () => ok(undefined),
    saveRitualTime: () => ok(undefined),
    getPartnerRitualTime: () => ok(null),
  },
};
