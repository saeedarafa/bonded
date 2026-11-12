import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';

import {
  coupleRole,
  notePushPermission,
  noteStreak,
  trackPaired,
} from '@/features/analytics/lifecycle';
import { trackFeedbackSent, useSendFeedback } from '@/features/feedback/hooks';
import { daysBetween } from '@/features/history/analytics';
import {
  noteOnboardingStarted,
  notePurchasedOnP3,
  trackFirstAnswerWritten,
  trackOnboardingFinished,
  trackStepBack,
  trackStepCompleted,
} from '@/features/onboarding/analytics';
import { usePendingSetup } from '@/features/onboarding/pendingSetup';
import { useOnboarding } from '@/features/onboarding/store';
import {
  codeResult,
  hoursSinceInvite,
  resetPairingAnalyticsForTests,
  trackCodeEntered,
  trackJoinCompleted,
} from '@/features/pairing/analytics';
import {
  acceptInvite,
  approveJoin,
  createInvite,
  declineJoin,
  inviteLink,
} from '@/features/pairing/api';
import { JoinPartnerConfirm } from '@/features/pairing/components/JoinPartnerConfirm';
import {
  useAcceptInvite,
  useApproveJoin,
  useCreateInvite,
  useDeclineJoin,
  useInviteLink,
} from '@/features/pairing/hooks';
import { usePendingJoin } from '@/features/pairing/joinRequest';
import { ritualTimeAnalyticsId } from '@/features/push/ritual';
import {
  acceptSoftAsk,
  acceptSoftAskSignedOut,
  declineSoftAsk,
  setSoftAskStorage,
} from '@/features/push/softAsk';
import {
  maybeRequestReview,
  recordSession,
  resetReviewSessionsForTests,
  setReviewStorage,
} from '@/features/review/review';
import { trackPrefsChanged } from '@/features/settings/hooks';
import { identifyUser, setPersonProperties } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { expectOnlyAllowedKeys, recordAnalytics } from '@/test/analytics';
import { memoryStorage } from '@/test/memoryStorage';
import { renderUi } from '@/test/render';

/**
 * MOB-24d (D54): the rest of the call sites. Each event fires with only its catalogue keys, and
 * nothing a person typed (names, the T1 answer, codes, tokens, times) is ever in a payload.
 */

jest.mock('@/features/pairing/api', () => ({
  ...jest.requireActual('@/features/pairing/api'),
  createInvite: jest.fn(),
  inviteLink: jest.fn(),
  acceptInvite: jest.fn(),
  approveJoin: jest.fn(),
  declineJoin: jest.fn(),
}));
jest.mock('@/features/push/api', () => ({
  saveRitualTime: jest.fn(() => Promise.resolve()),
  registerPushToken: jest.fn(() => Promise.resolve()),
  deletePushToken: jest.fn(() => Promise.resolve()),
  PARTNER_RITUAL_AVAILABLE: false,
  getPartnerRitualTime: () => Promise.resolve(null),
}));
jest.mock('@/features/push/registration', () => ({
  syncPushToken: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/feedback/api', () => ({
  ...jest.requireActual('@/features/feedback/api'),
  sendFeedback: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/auth/session', () => ({
  ...jest.requireActual('@/features/auth/session'),
  useSession: () => ({ status: 'signedIn', userId: 'u1' }),
}));

const N = jest.mocked(Notifications);
type Perm = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
const perm = (status: 'granted' | 'denied' | 'undetermined') =>
  ({
    status,
    granted: status === 'granted',
    canAskAgain: status !== 'denied',
    expires: 'never',
  }) as Perm;

const SECRET = ['Maya', 'Sam', 'my secret answer', '4827', 'tok_abcdefghijklmnop', '19:45'];

let rec: ReturnType<typeof recordAnalytics>;
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  rec = recordAnalytics();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  useOnboarding.getState().reset();
  usePendingSetup.getState().reset();
  usePendingJoin.getState().clear();
  resetPairingAnalyticsForTests();
  jest.clearAllMocks();
});
afterEach(() => {
  expectOnlyAllowedKeys(rec.captured);
  const payloads = JSON.stringify(rec.captured);
  for (const s of SECRET) expect(payloads).not.toContain(s);
  rec.stop();
});

describe('onboarding (§3.2)', () => {
  it('onboarding_step_completed carries the step and its option ids only', () => {
    const quiz = useOnboarding.getState();
    quiz.setStage('long_distance');
    quiz.setNames({ displayName: 'Sam', partnerName: 'Maya' });
    quiz.setLastLearned('this_month');
    quiz.toggleGoal('romance');
    quiz.toggleGoal('deep_talks');
    usePendingSetup.getState().setRitual('19:45', 'on');
    for (const step of [
      '/welcome',
      '/quiz/stage',
      '/quiz/names',
      '/story/1',
      '/story/2',
      '/quiz/goals',
      '/plan/moment',
      '/plan/trial',
    ] as const) {
      trackStepCompleted(step);
    }
    expect(rec.of('onboarding_step_completed')).toEqual([
      { step: '01' },
      { step: '05', stage: 'long_distance' },
      { step: '07', names_given: true },
      { step: '02' },
      { step: '03', last_learned: 'this_month' },
      { step: '06', goals: ['romance', 'deep_talks'] },
      // 19:45 is not a preset: `other`, never the time.
      { step: 'N', ritual_time: 'other' },
      { step: 'P3' },
    ]);
  });

  it('N with a preset sends it; names not given are false', () => {
    usePendingSetup.getState().setRitual('08:00', 'off');
    useOnboarding.getState().setNames({ displayName: 'Sam', partnerName: ' ' });
    trackStepCompleted('/plan/moment');
    trackStepCompleted('/quiz/names');
    expect(rec.of('onboarding_step_completed')).toEqual([
      { step: 'N', ritual_time: '08:00' },
      { step: '07', names_given: false },
    ]);
  });

  it('onboarding_back_pressed names the step', () => {
    trackStepBack('/quiz/goals');
    trackStepBack('/plan/first-question');
    expect(rec.of('onboarding_back_pressed')).toEqual([{ step: '06' }, { step: 'T1' }]);
  });

  it('first_answer_written: the length bucket, never the answer', () => {
    trackFirstAnswerWritten('my secret answer');
    trackFirstAnswerWritten('x'.repeat(80));
    trackFirstAnswerWritten('x'.repeat(151));
    expect(rec.of('first_answer_written')).toEqual([
      { length_bucket: '<50' },
      { length_bucket: '50-150' },
      { length_bucket: '150+' },
    ]);
  });

  it('onboarding_synced and onboarding_completed (duration, P3 purchase) once', () => {
    const start = Date.parse('2026-11-12T10:00:00Z');
    noteOnboardingStarted(start);
    notePurchasedOnP3();
    trackOnboardingFinished(
      { t1Saved: true, answersSynced: true, returning: false },
      start + 95_400,
    );
    // A second finish (another setup on this phone) has no clock: no second completion.
    trackOnboardingFinished({ t1Saved: false, answersSynced: false, returning: false });
    expect(rec.events()).toEqual(['onboarding_synced', 'onboarding_completed']);
    expect(rec.of('onboarding_synced')).toEqual([{ t1_saved: true }]);
    expect(rec.of('onboarding_completed')).toEqual([{ duration_s: 95, purchased_on_p3: true }]);
  });

  it('"I already have an account" (D40) is not an onboarding completion', () => {
    noteOnboardingStarted();
    trackOnboardingFinished({ t1Saved: false, answersSynced: true, returning: true });
    expect(rec.events()).toEqual(['onboarding_synced']);
  });
});

describe('reminder permission (§3.2)', () => {
  beforeEach(() => setSoftAskStorage(memoryStorage()));

  it('requested and result when the OS prompt shows (09, J6, N, 41)', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm('undetermined'));
    N.requestPermissionsAsync.mockResolvedValueOnce(perm('granted'));
    await acceptSoftAsk('u1', '21:00', '09');
    N.requestPermissionsAsync.mockResolvedValueOnce(perm('denied'));
    await acceptSoftAskSignedOut();
    expect(rec.captured).toEqual([
      { event: 'reminder_permission_requested', props: { screen: '09' } },
      { event: 'reminder_permission_result', props: { granted: true, screen: '09' } },
      { event: 'reminder_permission_requested', props: { screen: 'N' } },
      { event: 'reminder_permission_result', props: { granted: false, screen: 'N' } },
    ]);
  });

  it('no prompt (already decided in the OS): no event', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm('denied'));
    N.requestPermissionsAsync.mockResolvedValue(perm('denied'));
    await acceptSoftAsk('u1', '21:00', 'J6');
    expect(rec.captured).toEqual([]);
  });

  it('"Not now" is reminder_soft_ask_declined with the screen', () => {
    declineSoftAsk('J6');
    declineSoftAsk('N');
    expect(rec.of('reminder_soft_ask_declined')).toEqual([{ screen: 'J6' }, { screen: 'N' }]);
  });
});

describe('pairing (§3.4)', () => {
  const INVITE = { code: '4827', expiresAt: '2999-01-01T00:00:00Z', token: 'tok_abcdefghijklmnop' };

  it('pair_invite_created: a code, then a link for it', async () => {
    jest.mocked(createInvite).mockResolvedValue(INVITE);
    jest.mocked(inviteLink).mockResolvedValue(INVITE);
    const create = await renderHook(() => useCreateInvite(), { wrapper });
    await act(() => create.result.current.mutateAsync());
    const link = await renderHook(() => useInviteLink(), { wrapper });
    await act(() => link.result.current.mutateAsync());
    jest.mocked(inviteLink).mockResolvedValue(null);
    await act(() => link.result.current.mutateAsync());
    expect(rec.of('pair_invite_created')).toEqual([{ kind: 'code' }, { kind: 'link' }]);
  });

  it('a link joins at once: join_completed via link, with the D37 consent', async () => {
    jest.mocked(acceptInvite).mockResolvedValue({ kind: 'paired', coupleId: 'c1' });
    const accept = await renderHook(() => useAcceptInvite(), { wrapper });
    await act(() =>
      accept.result.current.mutateAsync({ code: '4827', token: INVITE.token, archiveOwn: true }),
    );
    // A retry after success (ALREADY_PAIRED = done) is not a second join.
    await act(() => accept.result.current.mutateAsync({ code: '4827', token: INVITE.token }));
    expect(rec.of('join_completed')).toEqual([{ via: 'link', archived_solo: true }]);
  });

  it('a typed code waits: join_request_pending, and the request remembers the consent', async () => {
    jest.mocked(acceptInvite).mockResolvedValue({
      kind: 'pending',
      requestId: 'r1',
      expiresAt: '2999-01-01T00:00:00Z',
    });
    const accept = await renderHook(() => useAcceptInvite(), { wrapper });
    await act(() => accept.result.current.mutateAsync({ code: '4827', token: null }));
    expect(rec.events()).toEqual(['join_request_pending']);
    expect(usePendingJoin.getState().pending?.archivedSolo).toBe(false);
  });

  it('join_request_answered on the inviter side', async () => {
    jest.mocked(approveJoin).mockResolvedValue('c1');
    jest.mocked(declineJoin).mockResolvedValue(undefined);
    const approve = await renderHook(() => useApproveJoin(), { wrapper });
    await act(() => approve.result.current.mutateAsync('r1'));
    const decline = await renderHook(() => useDeclineJoin(), { wrapper });
    await act(() => decline.result.current.mutateAsync('r2'));
    expect(rec.of('join_request_answered')).toEqual([{ approved: true }, { approved: false }]);
  });

  it('join_code_entered: the result only; offline or the D37 consent say nothing', () => {
    const e = (kind: string) => new AppError(kind as never, 'x');
    trackCodeEntered(null);
    trackCodeEntered(e('INVALID_CODE'));
    trackCodeEntered(e('INVITE_EXPIRED'));
    trackCodeEntered(e('RATE_LIMITED'));
    trackCodeEntered(e('COUPLE_FULL'));
    trackCodeEntered(e('NETWORK'));
    trackCodeEntered(e('CONFIRM_ARCHIVE'));
    expect(rec.of('join_code_entered')).toEqual([
      { result: 'ok' },
      { result: 'invalid' },
      { result: 'invalid' },
      { result: 'rate_limited' },
      { result: 'full' },
    ]);
    expect(codeResult(e('JOIN_REQUEST_FORBIDDEN'))).toBeNull();
  });

  it('join_completed once per code (an approved typed code)', () => {
    trackJoinCompleted('4827', { via: 'code', archivedSolo: false });
    trackJoinCompleted('4827', { via: 'code', archivedSolo: false });
    expect(rec.of('join_completed')).toEqual([{ via: 'code', archived_solo: false }]);
  });

  it('join_archive_confirm_shown when the D37 sheet opens', async () => {
    const props = {
      partner: 'Maya',
      loading: false,
      onConfirm: () => {},
      onCancel: () => {},
      testID: 'd37',
    };
    const closed = await renderUi(<JoinPartnerConfirm visible={false} {...props} />);
    expect(rec.captured).toEqual([]);
    await closed.unmount();
    await renderUi(<JoinPartnerConfirm visible {...props} />);
    expect(rec.events()).toEqual(['join_archive_confirm_shown']);
  });

  it('pair_waiting_viewed hours come from the 48 h invite', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(hoursSinceInvite('2026-11-14T09:00:00Z', now)).toBe(3);
    expect(hoursSinceInvite('2026-11-20T00:00:00Z', now)).toBe(0);
    expect(hoursSinceInvite(null, now)).toBeNull();
  });

  it('role: the member who joined first started the couple', () => {
    const couple = (a: string, b: string) =>
      ({
        id: 'c1',
        couple_members: [
          { user_id: 'u1', left_at: null, joined_at: a },
          { user_id: 'u2', left_at: null, joined_at: b },
        ],
      }) as never;
    expect(coupleRole(couple('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'), 'u1')).toBe(
      'starter',
    );
    expect(coupleRole(couple('2026-11-03T00:00:00Z', '2026-11-02T00:00:00Z'), 'u1')).toBe('joiner');
    expect(
      coupleRole({ id: 'c1', couple_members: [{ user_id: 'u1', left_at: null }] } as never, 'u1'),
    ).toBeNull();
  });

  it('paired: once per couple, only around the moment it happened', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const input = {
      coupleId: '00000000-0000-4000-a000-0000000000c1',
      pairedAt: '2026-11-12T10:00:00Z',
      role: 'joiner' as const,
      signedUpAt: '2026-11-11T10:00:00Z',
    };
    trackPaired({ ...input, role: null }, now);
    trackPaired(input, now);
    trackPaired(input, now);
    trackPaired(
      { ...input, coupleId: 'old', pairedAt: '2026-10-01T00:00:00Z', role: 'starter' },
      now,
    );
    expect(rec.of('paired')).toEqual([{ role: 'joiner', hours_from_signup: 24 }]);
  });
});

describe('streaks, badges, recap, review (§3.6)', () => {
  it('streak_extended and streak_broken against the last streak seen here', () => {
    noteStreak('c1', 4);
    noteStreak('c1', 5);
    noteStreak('c1', 5);
    noteStreak('c1', 0);
    noteStreak('c1', 1);
    expect(rec.captured).toEqual([
      { event: 'streak_extended', props: { streak: 5 } },
      { event: 'streak_broken', props: { previous_streak: 5 } },
      { event: 'streak_extended', props: { streak: 1 } },
    ]);
  });

  it('review_prompt_requested when the OS is asked', async () => {
    setReviewStorage(memoryStorage());
    resetReviewSessionsForTests();
    recordSession();
    recordSession();
    await maybeRequestReview(Date.parse('2026-11-12T12:00:00Z'));
    expect(rec.events()).toEqual(['review_prompt_requested']);
  });
});

describe('history, key dates, feedback (§3.7)', () => {
  it('days_ago between couple-local dates', () => {
    expect(daysBetween('2026-11-03', '2026-11-12')).toBe(9);
    expect(daysBetween('2026-11-12', '2026-11-12')).toBe(0);
    expect(daysBetween('nope', '2026-11-12')).toBeNull();
  });

  it('feedback_sent: one tag is the rating, never the text; the check-in sends its score', async () => {
    const send = await renderHook(() => useSendFeedback(), { wrapper });
    await act(() =>
      send.result.current.mutateAsync({
        kind: 'feedback',
        score: null,
        tags: ['reminder_timing'],
        body: 'my secret answer',
      }),
    );
    trackFeedbackSent({
      kind: 'feedback',
      score: null,
      tags: ['reminder_timing', 'something_else'],
    });
    trackFeedbackSent({ kind: 'check_in', score: 4, tags: [] });
    expect(rec.captured).toEqual([
      { event: 'feedback_sent', props: { rating: 'reminder_timing' } },
      { event: 'feedback_sent', props: {} },
      { event: 'check_in_answered', props: { score: 4 } },
    ]);
  });
});

describe('notifications (§3.8) and person properties (§2)', () => {
  it('push_setting_changed per switch and ritual_time_changed as a preset', () => {
    trackPrefsChanged({
      partner_answered: false,
      quiet_start: '22:00:00',
      little_things_sound: true,
    });
    trackPrefsChanged({ ritual_time: '12:30' });
    trackPrefsChanged({ ritual_time: '19:45:00' });
    expect(rec.captured).toEqual([
      { event: 'push_setting_changed', props: { type: 'partner_answered', enabled: false } },
      { event: 'ritual_time_changed', props: { ritual_time: '12:30' } },
      { event: 'ritual_time_changed', props: { ritual_time: 'other' } },
    ]);
    expect(ritualTimeAnalyticsId('21:00:00')).toBe('21:00');
  });

  it('push_permission_changed only when a decided permission flips', () => {
    notePushPermission('undetermined');
    notePushPermission('granted');
    notePushPermission('granted');
    notePushPermission('denied');
    notePushPermission('granted');
    expect(rec.of('push_permission_changed')).toEqual([{ granted: false }, { granted: true }]);
  });

  it('person properties ritual_time, push_enabled and role are checked like events', () => {
    identifyUser('00000000-0000-4000-a000-00000000a001');
    // Values outside the catalogue never leave the phone.
    setPersonProperties({ ritual_time: '21:00', push_enabled: true, role: 'starter' });
    setPersonProperties({ ritual_time: '19:45' as never, role: 'Maya' as never });
    expect(rec.people).toEqual([{ ritual_time: '21:00', push_enabled: true, role: 'starter' }]);
  });
});
