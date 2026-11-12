import {
  answerAccepted,
  answerFailed,
  answerQueuedOffline,
  forgetAnswerStarted,
  hoursAfterRitual,
  hoursSinceBothAnswered,
  noteAnswerSubmit,
  resetDailyAnalyticsForTests,
  trackAnswerStarted,
  trackOnce,
} from '@/features/daily/analytics';
import {
  notePurchased,
  paywallTrigger,
  productOf,
  purchasePending,
  resetPurchaseClockForTests,
  trackExitSheet,
  trackPremiumConfirmed,
  trackPurchaseOutcome,
  trackPurchaseStarted,
} from '@/features/premium/analytics';
import { identifyUser } from '@/lib/analytics';
import { expectOnlyAllowedKeys, recordAnalytics } from '@/test/analytics';

/**
 * MOB-24c (D54): the call-site helpers for the daily loop (§3.5) and the money funnel (§3.9).
 * Each event fires once, with only its catalogue keys; text becomes a bucket, never content.
 */

const Q = { question_id: '00000000-0000-4000-a000-0000000000a1', pack_id: null };
const PACK_Q = {
  question_id: '00000000-0000-4000-a000-0000000000a2',
  pack_id: '00000000-0000-4000-a000-0000000000b1',
};

let rec: ReturnType<typeof recordAnalytics>;
beforeEach(() => {
  rec = recordAnalytics();
  resetDailyAnalyticsForTests();
  resetPurchaseClockForTests();
});
afterEach(() => {
  expectOnlyAllowedKeys(rec.captured);
  rec.stop();
});

describe('daily loop (§3.5)', () => {
  it('daily_question_viewed and answer_locked_viewed once per question', () => {
    const view = { ...Q, partner_answered: false, i_answered: true, hours_after_ritual: -2 };
    trackOnce('daily_question_viewed', 'cq-1', view);
    trackOnce('daily_question_viewed', 'cq-1', view);
    trackOnce('answer_locked_viewed', 'cq-1', { question_id: Q.question_id });
    trackOnce('answer_locked_viewed', 'cq-1', { question_id: Q.question_id });
    trackOnce('daily_question_viewed', 'cq-2', view);
    expect(rec.events()).toEqual([
      'daily_question_viewed',
      'answer_locked_viewed',
      'daily_question_viewed',
    ]);
    expect(rec.of('daily_question_viewed')[0]).toEqual(view);
  });

  it('hours after the ritual time in the couple zone, signed; none without a time', () => {
    const at = new Date('2026-11-12T19:40:00Z');
    expect(hoursAfterRitual(at, '21:00:00', 'UTC')).toBe(-1);
    expect(hoursAfterRitual(at, '08:00:00', 'UTC')).toBe(11);
    expect(hoursAfterRitual(at, '21:00:00', 'Europe/Berlin')).toBe(0);
    expect(hoursAfterRitual(at, '12:30', 'Asia/Tokyo')).toBe(-7);
    expect(hoursAfterRitual(at, null, 'UTC')).toBeNull();
  });

  it('answer_started once per question and visit, for text or voice', () => {
    trackAnswerStarted('cq-1', Q, 'text');
    trackAnswerStarted('cq-1', Q, 'voice');
    trackAnswerStarted('cq-2', undefined, 'text');
    forgetAnswerStarted('cq-1');
    trackAnswerStarted('cq-1', Q, 'voice');
    expect(rec.of('answer_started')).toEqual([
      { question_id: Q.question_id, kind: 'text' },
      { question_id: Q.question_id, kind: 'voice' },
    ]);
  });

  it('answer_submitted once, when the server accepts: a length bucket, never the text', () => {
    const body = 'FIXTURE-ANSWER I felt closest to you on the beach last summer';
    noteAnswerSubmit('cq-1', { ref: Q, body, voiceMs: null, partnerAnswered: true });
    expect(rec.events()).toEqual([]);
    answerAccepted('cq-1');
    answerAccepted('cq-1');
    expect(rec.of('answer_submitted')).toEqual([
      {
        ...Q,
        kind: 'text',
        length_bucket: '50-150',
        partner_answered: true,
        edited: false,
        offline_queued: false,
      },
    ]);
    expect(JSON.stringify(rec.captured)).not.toMatch(/FIXTURE|beach/);
  });

  it('a voice answer queued offline: answer_queued_offline now, answer_submitted when sent', () => {
    noteAnswerSubmit('cq-2', { ref: PACK_Q, body: '', voiceMs: 20_000, partnerAnswered: false });
    answerQueuedOffline('cq-2');
    expect(rec.events()).toEqual(['answer_queued_offline']);
    answerAccepted('cq-2');
    expect(rec.of('answer_submitted')).toEqual([
      {
        ...PACK_Q,
        kind: 'voice',
        duration_bucket: '15-45s',
        partner_answered: false,
        edited: false,
        offline_queued: true,
      },
    ]);
  });

  it('a definite failure, or no question ids, sends nothing later', () => {
    noteAnswerSubmit('cq-1', { ref: Q, body: 'hi', voiceMs: null, partnerAnswered: false });
    answerFailed('cq-1');
    answerAccepted('cq-1');
    noteAnswerSubmit('cq-3', { ref: undefined, body: 'hi', voiceMs: null, partnerAnswered: false });
    answerAccepted('cq-3');
    expect(rec.of('answer_submitted')).toEqual([]);
  });

  it('nothing is noted while analytics is off', () => {
    rec.stop();
    noteAnswerSubmit('cq-1', { ref: Q, body: 'hi', voiceMs: null, partnerAnswered: false });
    rec = recordAnalytics();
    answerAccepted('cq-1');
    expect(rec.captured).toEqual([]);
  });

  it('hours since both answered: from the later answer, 0 when unknown', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(
      hoursSinceBothAnswered(
        [{ createdAt: '2026-11-12T08:59:00Z' }, { createdAt: '2026-11-12T02:00:00Z' }],
        now,
      ),
    ).toBe(3);
    expect(hoursSinceBothAnswered([{ createdAt: '' }, { createdAt: '' }], now)).toBe(0);
  });
});

describe('money funnel (§3.9)', () => {
  it('maps 16 sources to triggers; an unknown source has none', () => {
    expect(paywallTrigger('settings')).toBe('settings');
    expect(paywallTrigger('answer')).toBe('long_answer');
    expect(paywallTrigger('little_things')).toBe('little_things_limit');
    expect(paywallTrigger('streak_saver')).toBe('streak_saver');
    // MOB-24d: 16 from a locked History day (D55, ANALYTICS change log 2026-11-12).
    expect(paywallTrigger('history')).toBe('history');
    expect(paywallTrigger('somewhere')).toBeNull();
    expect(paywallTrigger(undefined)).toBeNull();
    expect(productOf({ kind: 'yearly' })).toBe('yearly_trial');
    expect(productOf({ kind: 'monthly' })).toBe('monthly');
  });

  it('purchase events carry ids and outcomes; premium_confirmed once after a purchase', () => {
    identifyUser('00000000-0000-4000-a000-00000000a001');
    const ctx = {
      paywall: '16' as const,
      plan: { kind: 'yearly' as const },
      offering: 'default' as const,
    };
    trackPurchaseStarted(ctx);
    trackPurchaseOutcome(
      ctx,
      { kind: 'failed', reason: 'network' },
      { isTrial: false, beforeSignIn: false },
    );
    trackPurchaseOutcome(ctx, { kind: 'cancelled' }, { isTrial: false, beforeSignIn: false });
    expect(purchasePending()).toBe(false);
    trackPremiumConfirmed();
    trackPurchaseOutcome(
      ctx,
      { kind: 'purchased', premiumHint: true },
      { isTrial: false, beforeSignIn: false },
    );
    expect(purchasePending()).toBe(true);
    expect(rec.people).toContainEqual({ plan: 'yearly' });
    trackPremiumConfirmed(Date.now() + 4_000);
    trackPremiumConfirmed();
    expect(rec.events()).toEqual([
      'purchase_started',
      'purchase_failed',
      'purchase_cancelled',
      'purchase_completed',
      'premium_confirmed',
    ]);
    expect(rec.of('purchase_failed')).toEqual([
      { paywall: '16', product: 'yearly_trial', error_code: 'network' },
    ]);
    expect(rec.of('premium_confirmed')).toEqual([{ seconds_after_purchase: 4 }]);
    expect(purchasePending()).toBe(false);
  });

  it('the gift (15) purchase also starts the premium_confirmed clock', () => {
    notePurchased({ kind: 'yearly' });
    trackPremiumConfirmed();
    expect(rec.of('premium_confirmed')).toHaveLength(1);
  });

  it('closing a paywall into 17', () => {
    trackExitSheet('P3');
    expect(rec.captured).toEqual([
      { event: 'paywall_closed', props: { paywall: 'P3' } },
      { event: 'exit_sheet_viewed', props: {} },
    ]);
  });
});
