import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';

import type { SessionState } from '@/features/auth/session';
import type { ExitOfferReply } from '@/features/premium/api';
import { usePurchasesIdentity } from '@/features/premium/hooks';
import { exitRecordSettled, useExitOfferDevice } from '@/features/premium/offers';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import { purchasesMock } from '@/test/purchases';

/**
 * #380 (MOB-76, D57 once per person): the P3 exit sheet showed signed out, so after sign-in the app
 * records it with `open_exit_offer('paywall_close')`. The device flag clears only when the server
 * now holds the row (`eligible: true`, `shown_before`) or the offer can never show (`premium`,
 * `not_intro_eligible`). A refusal that writes nothing (`gift_live`, `daily_limit`) or an error
 * keeps it, so the next launch tries again and 16 cannot show the offer a second time.
 */
const mockReply = jest.fn<Promise<ExitOfferReply>, [string, string]>();
jest.mock('@/features/premium/api', () => ({
  openExitOfferReply: (trigger: string, id: string) => mockReply(trigger, id),
  syncRevenueCat: jest.fn(),
  getEntitlements: () => Promise.resolve([]),
  getOffer: jest.fn(),
}));

const SESSION = { status: 'signedIn', userId: 'u1' } as SessionState;

function Probe({ session }: { session: SessionState }) {
  usePurchasesIdentity(session);
  return null;
}

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  useExitOfferDevice.setState({ shown: true, toRecord: true });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  useExitOfferDevice.setState({ shown: false, toRecord: false });
  qc.clear();
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

/** One app launch, signed in. */
async function launch(session: SessionState = SESSION) {
  const view = await render(
    <QueryClientProvider client={qc}>
      <Probe session={session} />
    </QueryClientProvider>,
  );
  return view;
}

/** Lets the reply's promise chain settle. */
async function settle() {
  await waitFor(() => expect(mockReply).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
}

describe('P3 exit record after sign-in (#380)', () => {
  it('eligible: the server wrote the row, the flag clears', async () => {
    mockReply.mockResolvedValue({ eligible: true, reason: null });
    await launch();
    await waitFor(() => expect(useExitOfferDevice.getState().toRecord).toBe(false));
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(mockReply.mock.calls[0]![0]).toBe('paywall_close');
    expect(useExitOfferDevice.getState().shown).toBe(true);
  });

  it('shown_before: the server already holds the row, the flag clears', async () => {
    mockReply.mockResolvedValue({ eligible: false, reason: 'shown_before' });
    await launch();
    await waitFor(() => expect(useExitOfferDevice.getState().toRecord).toBe(false));
  });

  it.each(['premium', 'not_intro_eligible'])(
    '%s: the offer can never show, the flag clears',
    async (reason) => {
      mockReply.mockResolvedValue({ eligible: false, reason });
      await launch();
      await waitFor(() => expect(useExitOfferDevice.getState().toRecord).toBe(false));
    },
  );

  it.each(['gift_live', 'daily_limit', 'unknown_trigger', 'something_new'])(
    '%s: nothing written, the flag stays and the next launch retries',
    async (reason) => {
      mockReply.mockResolvedValue({ eligible: false, reason });
      const first = await launch();
      await settle();
      expect(useExitOfferDevice.getState().toRecord).toBe(true);
      await first.unmount();

      // Next launch: the day-3 gift has ended / the day slot is free, and the server records it.
      mockReply.mockClear();
      mockReply.mockResolvedValue({ eligible: true, reason: null });
      await launch();
      await waitFor(() => expect(useExitOfferDevice.getState().toRecord).toBe(false));
      expect(mockReply).toHaveBeenCalledTimes(1);
    },
  );

  it('error: the flag stays (tried again next launch)', async () => {
    mockReply.mockRejectedValue(new Error('offline'));
    await launch();
    await settle();
    expect(useExitOfferDevice.getState().toRecord).toBe(true);
  });

  it('nothing to record: the server is not asked', async () => {
    useExitOfferDevice.setState({ shown: true, toRecord: false });
    await launch();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('signed out: the server is not asked, the flag stays', async () => {
    await launch({ status: 'signedOut', userId: null } as unknown as SessionState);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockReply).not.toHaveBeenCalled();
    expect(useExitOfferDevice.getState().toRecord).toBe(true);
  });
});

describe('exitRecordSettled', () => {
  it.each<[ExitOfferReply, boolean]>([
    [{ eligible: true, reason: null }, true],
    [{ eligible: false, reason: 'shown_before' }, true],
    [{ eligible: false, reason: 'premium' }, true],
    [{ eligible: false, reason: 'not_intro_eligible' }, true],
    [{ eligible: false, reason: 'gift_live' }, false],
    [{ eligible: false, reason: 'daily_limit' }, false],
    [{ eligible: false, reason: 'no_subscription' }, false],
    [{ eligible: false, reason: 'unknown_trigger' }, false],
    [{ eligible: false, reason: null }, false],
  ])('%j -> %s', (reply, settled) => {
    expect(exitRecordSettled(reply)).toBe(settled);
  });
});
