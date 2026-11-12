import { onlineManager } from '@tanstack/react-query';

import { usePendingPurchase } from '@/features/premium/pendingPurchase';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import { expectOnlyAllowedKeys, recordAnalytics } from '@/test/analytics';
import { purchasesMock } from '@/test/purchases';

import { useOnboardingSync } from '../answerSync';
import { finishOnboarding, isKeyDatesWriteError, resetFinishAnalyticsForTests } from '../finish';
import { usePendingSetup } from '../pendingSetup';
import { useOnboarding } from '../store';

/**
 * MOB-61: the CONTRACTS §2 "Finishing onboarding" call order, through the real api modules
 * against a fake Supabase client that records every request in order.
 */
type Call = { op: string; table?: string; fn?: string; args: unknown[] };
const mockCalls: Call[] = [];
/** Per request key (`rpc:create_couple`, `upsert:answers`, …): errors to return, in order. */
const mockFailures = new Map<string, { message: string }[]>();
const mockRpcData: Record<string, unknown> = {
  create_couple: 'c1',
  get_daily_question: { id: 'cq-day1' },
};

function mockResult(key: string, data: unknown) {
  const error = mockFailures.get(key)?.shift() ?? null;
  return { data: error ? null : data, error };
}

function mockTable(table: string) {
  const builder: Record<string, unknown> = {};
  let key = '';
  for (const op of ['update', 'upsert', 'insert', 'select']) {
    builder[op] = (...args: unknown[]) => {
      key ||= `${op}:${table}`;
      mockCalls.push({ op, table, args });
      return builder;
    };
  }
  builder.eq = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(mockResult(key, null)).then(resolve);
  return builder;
}

/** `revenuecat-sync` answers (MOB-62): `ok`, or an HTTP status for the error. */
let mockSyncStatus: number = 200;
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (fn: string, options: unknown) => {
        mockCalls.push({ op: 'fn', fn, args: [options] });
        return Promise.resolve(
          mockSyncStatus === 200
            ? { data: { ok: true, is_active: true }, error: null }
            : { data: null, error: { context: { status: mockSyncStatus } } },
        );
      },
    },
    from: (table: string) => mockTable(table),
    rpc: (fn: string, args?: unknown) => {
      mockCalls.push({ op: 'rpc', fn, args: [args] });
      return Promise.resolve(mockResult(`rpc:${fn}`, mockRpcData[fn]));
    },
  },
}));

const BODY = 'FIXTURE-T1 Your laugh, before I even saw you';

const step = (c: Call) =>
  c.op === 'rpc' || c.op === 'fn' || c.op === 'sdk' ? `${c.op}:${c.fn}` : `${c.op}:${c.table}`;

beforeEach(() => {
  mockSyncStatus = 200;
  resetPurchasesForTests();
  usePendingPurchase.getState().clear();
  purchasesMock.logIn.mockImplementation((uid: string) => {
    mockCalls.push({ op: 'sdk', fn: 'logIn', args: [uid] });
    return Promise.resolve({ customerInfo: {}, created: false });
  });
  mockCalls.length = 0;
  mockFailures.clear();
  onlineManager.setOnline(true);
  useOnboardingSync.getState().reset();
  usePendingSetup.getState().reset();
  const s = useOnboarding.getState();
  s.reset();
  s.setStage('dating');
  s.setLastLearned('this_week');
  s.toggleGoal('romance');
  s.confirmGoals();
  s.setNames({ displayName: ' Alex ', partnerName: ' Sam ' });
  s.setKeyDates({ birthday: '1990-05-09' }, true);
  usePendingSetup.getState().setFirstAnswer(BODY);
  usePendingSetup.getState().setRitual('19:45', 'off');
});

beforeAll(() => {
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

describe('finishOnboarding: a P3 purchase made signed out (MOB-62, CONTRACTS §2 step 2)', () => {
  it('logIn(uid) → revenuecat-sync before anything else; the purchase is then no longer pending', async () => {
    usePendingPurchase.getState().mark();
    await expect(finishOnboarding({ userId: 'u1' })).resolves.toMatchObject({ kind: 'done' });
    expect(mockCalls.map(step).slice(0, 3)).toEqual([
      'sdk:logIn',
      'fn:revenuecat-sync',
      'update:profiles',
    ]);
    expect(mockCalls[0]!.args).toEqual(['u1']);
    expect(mockCalls[1]!.args).toEqual([{ method: 'POST', body: {} }]);
    expect(usePendingPurchase.getState().pending).toBe(false);
  });

  it.each([429, 500, 503])(
    'a refused sync (%i) never fails the setup; the purchase stays marked for a retry',
    async (status) => {
      mockSyncStatus = status;
      usePendingPurchase.getState().mark();
      await expect(finishOnboarding({ userId: 'u1' })).resolves.toMatchObject({ kind: 'done' });
      expect(mockCalls.map(step)).toContain('fn:revenuecat-sync');
      expect(usePendingPurchase.getState().pending).toBe(true);
    },
  );

  it('no P3 purchase: no sync call (the session hook still logs RevenueCat in)', async () => {
    await finishOnboarding({ userId: 'u1' });
    expect(mockCalls.map(step)).not.toContain('fn:revenuecat-sync');
  });
});

describe('finishOnboarding (MOB-61, CONTRACTS §2 call order)', () => {
  it('profile → create_couple → ritual time → v2 answers → get_daily_question → answer → key dates', async () => {
    await expect(finishOnboarding({ userId: 'u1' })).resolves.toEqual({
      kind: 'done',
      coupleId: 'c1',
    });
    expect(mockCalls.map(step)).toEqual([
      'update:profiles',
      'rpc:create_couple',
      'upsert:notification_prefs',
      'upsert:onboarding_answers',
      'rpc:get_daily_question',
      'upsert:answers',
      'upsert:key_dates',
    ]);
    const byStep = (s: string) => mockCalls.find((c) => step(c) === s)!;
    expect(byStep('upsert:notification_prefs').args).toEqual([
      { user_id: 'u1', ritual_time: '19:45' },
      { onConflict: 'user_id' },
    ]);
    // T1: my answer to the new couple's day-1 question, without client_written_at.
    expect(byStep('upsert:answers').args).toEqual([
      { couple_question_id: 'cq-day1', user_id: 'u1', body: BODY },
      { onConflict: 'couple_question_id,user_id' },
    ]);
    // Written once: nothing of T1 or N is left on the phone.
    expect(usePendingSetup.getState()).toMatchObject({
      firstAnswer: null,
      ritualTime: null,
      reminders: null,
    });
  });

  it('a failed T1 write keeps the answer; Try again repeats every step and writes it once', async () => {
    mockFailures.set('upsert:answers', [{ message: 'Network request failed' }]);
    await expect(finishOnboarding({ userId: 'u1' })).rejects.toMatchObject({ kind: 'NETWORK' });
    expect(usePendingSetup.getState().firstAnswer?.body).toBe(BODY);
    expect(mockCalls.map(step)).not.toContain('upsert:key_dates');

    mockCalls.length = 0;
    await expect(finishOnboarding({ userId: 'u1' })).resolves.toMatchObject({ kind: 'done' });
    // Same couple, same question, same row (upsert key); then the local copy is gone.
    expect(mockCalls.filter((c) => step(c) === 'upsert:answers')).toHaveLength(1);
    expect(usePendingSetup.getState().firstAnswer).toBeNull();
  });

  it('after T1 is in, a later retry (refused key dates) never sends it again', async () => {
    mockFailures.set('upsert:key_dates', [{ message: 'boom' }]);
    const error = await finishOnboarding({ userId: 'u1' }).catch((e: unknown) => e);
    expect(isKeyDatesWriteError(error)).toBe(true);
    expect(mockCalls.filter((c) => step(c) === 'upsert:answers')).toHaveLength(1);

    mockCalls.length = 0;
    await finishOnboarding({ userId: 'u1', skipKeyDates: true });
    expect(mockCalls.map(step)).not.toContain('rpc:get_daily_question');
    expect(mockCalls.map(step)).not.toContain('upsert:answers');
    // The ritual time was written the first time too.
    expect(mockCalls.map(step)).not.toContain('upsert:notification_prefs');
  });

  it('ALREADY_PAIRED stops after create_couple and drops the local T1 answer', async () => {
    mockFailures.set('rpc:create_couple', [{ message: 'ALREADY_PAIRED' }]);
    await expect(finishOnboarding({ userId: 'u1' })).resolves.toEqual({ kind: 'alreadyPaired' });
    expect(mockCalls.map(step)).toEqual(['update:profiles', 'rpc:create_couple']);
    expect(usePendingSetup.getState().firstAnswer).toBeNull();
  });

  it('without T1 or N (an older path): no ritual write, no question read, no answer', async () => {
    usePendingSetup.getState().reset();
    await finishOnboarding({ userId: 'u1' });
    expect(mockCalls.map(step)).toEqual([
      'update:profiles',
      'rpc:create_couple',
      'upsert:onboarding_answers',
      'upsert:key_dates',
    ]);
  });

  it('a failed answers write does not block T1 (the answers stay queued)', async () => {
    mockFailures.set('upsert:onboarding_answers', [{ message: 'Network request failed' }]);
    await expect(finishOnboarding({ userId: 'u1' })).resolves.toMatchObject({ kind: 'done' });
    expect(mockCalls.map(step)).toContain('upsert:answers');
    expect(Object.values(useOnboardingSync.getState().pending)).toHaveLength(3);
  });
});

describe('finishOnboarding analytics (MOB-24d, ANALYTICS §3.2–§3.4, §3.7)', () => {
  it('solo couple, synced answers with T1, key dates by kind; nothing typed is sent', async () => {
    resetFinishAnalyticsForTests();
    const rec = recordAnalytics();
    try {
      await expect(finishOnboarding({ userId: 'u1' })).resolves.toMatchObject({ kind: 'done' });
      expect(rec.events()).toEqual(['solo_couple_created', 'key_date_added', 'onboarding_synced']);
      expect(rec.of('key_date_added')).toEqual([{ type: 'birthday' }]);
      expect(rec.of('onboarding_synced')).toEqual([{ t1_saved: true }]);
      expect(JSON.stringify(rec.captured)).not.toMatch(/FIXTURE|Alex|Sam|19:45|1990/);
      expectOnlyAllowedKeys(rec.captured);
    } finally {
      rec.stop();
    }
  });

  it('a retry after a refused key-dates write reports the couple and T1 once', async () => {
    resetFinishAnalyticsForTests();
    const rec = recordAnalytics();
    try {
      mockFailures.set('upsert:key_dates', [{ message: 'nope' }]);
      await expect(finishOnboarding({ userId: 'u1' })).rejects.toBeTruthy();
      await expect(finishOnboarding({ userId: 'u1' })).resolves.toMatchObject({ kind: 'done' });
      expect(rec.of('solo_couple_created')).toHaveLength(1);
      expect(rec.of('onboarding_synced')).toEqual([{ t1_saved: true }]);
    } finally {
      rec.stop();
    }
  });
});
