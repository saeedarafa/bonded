/**
 * Query keys (MOB-06). One factory so every hook, mutation and realtime invalidation spells a key
 * the same way. Keys are hierarchical: invalidating `queryKeys.questions.all` hits every question
 * detail; `queryKeys.thread.detail(id)` hits one thread.
 *
 * Keys hold ids and filters only, never answer or message text (they can reach logs and devtools).
 * Nothing is scoped by user id: the cache is wiped on sign-out (src/lib/queryClient.ts).
 */
export const queryKeys = {
  profiles: {
    all: ['profiles'] as const,
    /** My row and my partner's (RLS returns both). */
    couple: () => ['profiles', 'couple'] as const,
  },
  couple: {
    all: ['couple'] as const,
    active: () => ['couple', 'active'] as const,
    ended: () => ['couple', 'ended'] as const,
    keyDates: () => ['couple', 'key-dates'] as const,
  },
  /** `get_daily_question()`: today's couple_questions row. */
  today: {
    all: ['today'] as const,
    question: () => ['today', 'question'] as const,
  },
  /** `couple_questions` detail with `question` and `answers`. */
  questions: {
    all: ['questions'] as const,
    detail: (coupleQuestionId: string) => ['questions', 'detail', coupleQuestionId] as const,
  },
  /** MOB-16: everything about past questions (realtime on answers/couple_questions refreshes it). */
  history: {
    all: ['history'] as const,
    list: (coupleId: string) => ['history', 'list', coupleId] as const,
    month: (coupleId: string, month: string) => ['history', 'month', coupleId, month] as const,
    start: (coupleId: string) => ['history', 'start', coupleId] as const,
    detail: (coupleQuestionId: string) => ['history', 'detail', coupleQuestionId] as const,
    lastMessage: (coupleQuestionId: string) =>
      ['history', 'last-message', coupleQuestionId] as const,
  },
  thread: {
    all: ['thread'] as const,
    detail: (coupleQuestionId: string) => ['thread', coupleQuestionId] as const,
    unread: () => ['thread', 'unread'] as const,
    unreadFor: (coupleQuestionId: string) => ['thread', 'unread', coupleQuestionId] as const,
    /** `unread_thread_counts()` for every thread at once (History rows). */
    unreadCounts: () => ['thread', 'unread', 'counts'] as const,
  },
  streak: () => ['streak'] as const,
  invite: {
    open: () => ['invite', 'open'] as const,
  },
  /** BE-26 typed-code approval: the inviter's pending list and the joiner's own request. */
  joinRequests: {
    all: ['join-requests'] as const,
    pending: () => ['join-requests', 'pending'] as const,
    mine: (requestId: string) => ['join-requests', 'mine', requestId] as const,
  },
  packs: {
    all: ['packs'] as const,
    list: () => ['packs', 'list'] as const,
  },
  entitlements: () => ['entitlements'] as const,
  /** Badge catalogue and the couple's (and my) awards (BE-12, MOB-17). */
  badges: {
    all: ['badges'] as const,
    catalogue: () => ['badges', 'catalogue'] as const,
    awards: () => ['badges', 'awards'] as const,
  },
  notificationPrefs: () => ['notification-prefs'] as const,
  /** J6: the partner's ritual time (no other prefs of theirs). */
  partnerRitualTime: () => ['notification-prefs', 'partner'] as const,
  recap: (weekStart: string) => ['recap', weekStart] as const,
  offer: (kind: 'intro' | 'winback') => ['offer', kind] as const,
} as const;
