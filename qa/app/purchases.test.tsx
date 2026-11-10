// QA-06: restore, payment failed (57) and "success only after the server confirms" on paywall 16,
// one layer lower than mobile's screen tests: the real Supabase client, premium api and hooks run
// against a fake PostgREST server (the fetch seam), and RevenueCat is the SDK stand-in from
// src/test/purchases.ts. The server's entitlements rows follow qa/fixtures/revenuecat-events.json
// (the row a webhook writes for app_user_id), so the app sees what BE-18 would have written.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';
import { PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { confirmTiming } from '@/features/premium/hooks';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import PaywallScreen from '@/features/premium/screens/PaywallScreen';
import { fakeOfferings, purchasesMock } from '@/test/purchases';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui';

import fixtures from '../fixtures/revenuecat-events.json';
import personas from '../fixtures/personas.json';

const MAYA = personas.personas.maya.id; // the fixtures' app_user_id
const SAM = personas.personas.sam.id;
const LEA = personas.personas.lea.id;

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: jest.requireActual('../fixtures/personas.json').personas.maya.id }),
}));
jest.mock('@/features/couple/api', () => {
  const p = jest.requireActual('../fixtures/personas.json').personas;
  return {
    getActiveCouple: () =>
      Promise.resolve({
        id: 'fixture-couple-maya-sam',
        couple_members: [
          { user_id: p.maya.id, left_at: null },
          { user_id: p.sam.id, left_at: null },
        ],
      }),
  };
});
jest.mock('@/features/profile/api', () => {
  const p = jest.requireActual('../fixtures/personas.json').personas;
  return {
    getCoupleProfiles: () =>
      Promise.resolve([
        { id: p.maya.id, display_name: 'Maya', avatar_url: null },
        { id: p.sam.id, display_name: 'Sam', avatar_url: null },
      ]),
  };
});

// ───────────────────────────── fake PostgREST ─────────────────────────────

type Row = { user_id: string; is_active: boolean; expires_at: string | null };
const FUTURE = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

/** The row BE-18 writes after a fixture event (expiry moved to a future/past instant). */
function rowAfter(name: keyof typeof fixtures.events, user = MAYA): Row {
  const expect = fixtures.events[name].expect as { is_active?: boolean; expires_at?: null };
  return {
    user_id: user,
    is_active: expect.is_active ?? true,
    expires_at: expect.expires_at === null ? null : expect.is_active === false ? null : FUTURE,
  };
}

const server = {
  /** Rows per entitlements read, in order; the last one repeats. */
  script: [[]] as Row[][],
  reads: 0,
  /** Rows of each read, for "what had the server said when the app showed success?". */
  served: [] as Row[][],
  other: [] as string[],
};
function serve(...script: Row[][]) {
  server.script = script;
}

function fakePostgrest(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  if (url.pathname === '/rest/v1/entitlements') {
    const rows = server.script[Math.min(server.reads, server.script.length - 1)] ?? [];
    server.reads += 1;
    server.served.push(rows);
    return json(rows);
  }
  server.other.push(url.pathname);
  if (url.pathname === '/rest/v1/couple_offers') return json([]);
  return Promise.resolve(new Response('{}', { status: 404 }));
}

/** The entitlements read right before the app navigated to 35. */
function servedBeforeSuccess(): Row[] {
  return server.served[server.served.length - 1] ?? [];
}

// ───────────────────────────── harness ─────────────────────────────

let qc: QueryClient;
async function renderPaywall(ui: ReactElement = <PaywallScreen />) {
  await renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  await screen.findByTestId('16-buy'); // the offering's plans are in
  await waitFor(() => expect(server.reads).toBeGreaterThanOrEqual(1));
}
const readsNow = () => server.reads;
const PREMIUM_HINT = { entitlements: { active: { premium: {} } } };
const NO_HINT = { entitlements: { active: {} } };
const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_fixture_qa06';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  purchasesMock.purchasePackage.mockReset();
  purchasesMock.restorePurchases.mockReset();
  purchasesMock.restorePurchases.mockResolvedValue(NO_HINT);
  server.script = [[]];
  server.reads = 0;
  server.served = [];
  server.other = [];
  (globalThis as unknown as { __qaFetch?: unknown }).__qaFetch = fakePostgrest;
  confirmTiming.attempts = 4;
  confirmTiming.intervalMs = 5;
  useToast.getState().hide();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const m of ['log', 'warn', 'error', 'info'] as const) {
    consoleSpies.push(jest.spyOn(console, m).mockImplementation(() => {}));
  }
});

// No purchase, receipt, price, key or user id may reach the console (privacy rule).
const PURCHASE_DATA = new RegExp(`PRICE|receipt|\\$rc_|appl_fixture|${MAYA}|${SAM}`, 'i');
afterEach(() => {
  for (const spy of consoleSpies.splice(0)) {
    const logged = spy.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toMatch(PURCHASE_DATA);
    spy.mockRestore();
  }
  // The paywall never starts an offer clock (D28): no get_offer call reached the server.
  expect(server.other).not.toContain('/rest/v1/rpc/get_offer');
  delete (globalThis as unknown as { __qaFetch?: unknown }).__qaFetch;
  qc.clear();
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

// ───────────────────────────── restore ─────────────────────────────

describe('16 restore', () => {
  it('success: the store restores premium; 35 only once the server row (INITIAL_PURCHASE) is read', async () => {
    serve([], [], [], [rowAfter('initial_purchase_trial')]);
    purchasesMock.restorePurchases.mockResolvedValue(PREMIUM_HINT);
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-restore'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/success', params: {} }),
    );
    expect(servedBeforeSuccess()).toEqual([rowAfter('initial_purchase_trial')]);
    expect(server.reads).toBe(4);
    expect(purchasesMock.logIn).toHaveBeenCalledWith(MAYA);
    expect(purchasesMock.restorePurchases).toHaveBeenCalledTimes(1);
  });

  it('restored on the store, server never confirms: "confirming", no 35; Check again then 35', async () => {
    purchasesMock.restorePurchases.mockResolvedValue(PREMIUM_HINT);
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-restore'));
    expect(await screen.findByTestId('16-notice-confirming')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    serve([rowAfter('renewal')]);
    await fireEvent.press(screen.getByTestId('16-check-again'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(servedBeforeSuccess()).toEqual([rowAfter('renewal')]);
  });

  it('nothing to restore: the toast, one server check, no navigation', async () => {
    await renderPaywall();
    const before = readsNow();
    await fireEvent.press(screen.getByTestId('16-restore'));
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe(
        'No purchases to restore on this store account.',
      ),
    );
    expect(readsNow() - before).toBe(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('57-sheet')).toBeNull();
  });

  it("nothing to restore, but Sam's purchase has landed meanwhile: covered, 35", async () => {
    await renderPaywall();
    serve([rowAfter('initial_purchase_trial', SAM)]);
    await fireEvent.press(screen.getByTestId('16-restore'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(useToast.getState().toast).toBeNull();
  });

  it('the store says premium but the server row has expired (EXPIRATION / stale): no 35', async () => {
    serve([{ user_id: MAYA, is_active: true, expires_at: PAST }]);
    purchasesMock.restorePurchases.mockResolvedValue(PREMIUM_HINT);
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-restore'));
    expect(await screen.findByTestId('16-notice-confirming')).toBeTruthy();
    serve([rowAfter('expiration')]);
    await fireEvent.press(screen.getByTestId('16-check-again'));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("a former partner's active row (Lea, RLS-readable after unpairing) does not confirm a restore", async () => {
    await renderPaywall();
    serve([rowAfter('initial_purchase_trial', LEA)]);
    await fireEvent.press(screen.getByTestId('16-restore'));
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe(
        'No purchases to restore on this store account.',
      ),
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('restore offline: the network notice; a store error: the retry toast; never 57', async () => {
    purchasesMock.restorePurchases.mockRejectedValueOnce({
      code: PURCHASES_ERROR_CODE.NETWORK_ERROR,
    });
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-restore'));
    expect(await screen.findByTestId('16-notice-network')).toBeTruthy();
    purchasesMock.restorePurchases.mockRejectedValueOnce({
      code: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
    });
    await fireEvent.press(screen.getByTestId('16-restore'));
    await waitFor(() =>
      expect(useToast.getState().toast?.message).toBe(
        "We couldn't restore your purchases. Try again.",
      ),
    );
    expect(screen.queryByTestId('57-sheet')).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── purchase and 57 ─────────────────────────────

describe('16 purchase: success only after the server confirms', () => {
  it('the SDK says premium at once; 35 waits for the webhook row (two empty reads first)', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: PREMIUM_HINT });
    await renderPaywall();
    const before = readsNow();
    serve([], [], [rowAfter('initial_purchase_trial')]);
    server.reads = 0; // the script starts at the purchase
    await fireEvent.press(screen.getByTestId('16-buy'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/success', params: {} }),
    );
    expect(servedBeforeSuccess()).toEqual([rowAfter('initial_purchase_trial')]);
    expect(server.reads).toBe(3);
    expect(before).toBeGreaterThanOrEqual(1);
  });

  it('the webhook never lands: "confirming", never 35, buying is disabled while confirming', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: PREMIUM_HINT });
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-buy'));
    expect(await screen.findByTestId('16-notice-confirming')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('16-buy'));
    expect(purchasesMock.purchasePackage).toHaveBeenCalledTimes(1);
  });

  it('billing grace (BILLING_ISSUE row) counts as premium on the server: confirms', async () => {
    purchasesMock.purchasePackage.mockResolvedValue({ customerInfo: PREMIUM_HINT });
    await renderPaywall();
    serve([rowAfter('billing_issue')]);
    await fireEvent.press(screen.getByTestId('16-buy'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  });

  it('ask to buy (pending): the pending notice, no poll, no 35', async () => {
    purchasesMock.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR,
    });
    await renderPaywall();
    const before = readsNow();
    await fireEvent.press(screen.getByTestId('16-buy'));
    expect(await screen.findByTestId('16-notice-pending')).toBeTruthy();
    expect(readsNow()).toBe(before);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('57 payment failed', () => {
  const refused = [
    ['STORE_PROBLEM_ERROR', PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR],
    ['PURCHASE_NOT_ALLOWED_ERROR', PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR],
    ['PURCHASE_INVALID_ERROR', PURCHASES_ERROR_CODE.PURCHASE_INVALID_ERROR],
    ['INELIGIBLE_ERROR', PURCHASES_ERROR_CODE.INELIGIBLE_ERROR],
    ['an unknown SDK error', 'FIXTURE_UNKNOWN'],
  ] as const;

  it.each(refused)('%s: 57 "Nothing was charged", no server poll, no 35', async (_name, code) => {
    purchasesMock.purchasePackage.mockRejectedValue({ code });
    await renderPaywall();
    const before = readsNow();
    await fireEvent.press(screen.getByTestId('16-buy'));
    expect(await screen.findByTestId('57-sheet')).toBeTruthy();
    expect(screen.getByText("Payment didn't go through")).toBeTruthy();
    expect(
      screen.getByText(
        'Nothing was charged. Check your payment method in the App Store, then try again.',
      ),
    ).toBeTruthy();
    expect(readsNow()).toBe(before);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('Try again buys again; a success then still waits for the server', async () => {
    purchasesMock.purchasePackage
      .mockRejectedValueOnce({ code: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR })
      .mockResolvedValueOnce({ customerInfo: PREMIUM_HINT });
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-buy'));
    await fireEvent.press(await screen.findByTestId('57-retry'));
    await waitFor(() => expect(purchasesMock.purchasePackage).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('16-notice-confirming')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    serve([rowAfter('initial_purchase_trial')]);
    await fireEvent.press(screen.getByTestId('16-check-again'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  });

  it("Manage payment method opens the store's subscription page", async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    purchasesMock.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR,
    });
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-buy'));
    await fireEvent.press(await screen.findByTestId('57-manage'));
    expect(open).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
    open.mockRestore();
  });

  it('cancelled by the user is not a failure: no 57, no notice', async () => {
    purchasesMock.purchasePackage.mockRejectedValue({
      code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR,
      userCancelled: true,
    });
    await renderPaywall();
    await fireEvent.press(screen.getByTestId('16-buy'));
    await waitFor(() => expect(purchasesMock.purchasePackage).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByTestId('57-sheet')).toBeNull();
    expect(screen.queryByTestId(/16-notice/)).toBeNull();
  });
});
