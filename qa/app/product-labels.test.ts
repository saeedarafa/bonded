// QA-51 (D60, ANALYTICS §3.9): the PostHog `product` label is a D60 vocabulary word, never a store
// product id. The RevenueCat Test Store sells `yearly_v2`, `monthly_v2`, `yearly_day3_v2` and
// `yearly_exit30_v2`; the stores will later sell `yearly`, `monthly`, `yearly_day3` and
// `yearly_exit30`; an old build knew `yearly_trial`. Whatever ids the offerings carry, the wire must
// say `yearly` | `monthly` | `yearly_day3` | `yearly_exit30` (from offering + package type only) and
// no product id may appear anywhere in a request.
//
// One layer below the device, like privacy.test.ts: the app's real purchases module
// (loadOffering, purchasePlan) runs on the react-native-purchases stand-in, the app's real
// analytics helpers (trackPurchaseStarted / trackPurchaseOutcome, called the way 16, P3 and the
// offer screens call them) drive the real PostHog SDK, and the fetch seam captures every request.
import { gunzipSync } from 'node:zlib';

import { PACKAGE_TYPE, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import {
  resetPurchaseClockForTests,
  trackPurchaseOutcome,
  trackPurchaseStarted,
} from '@/features/premium/analytics';
import {
  loadOffering,
  purchasePlan,
  resetPurchasesForTests,
  type OfferingId,
} from '@/features/premium/purchases';
import { PRODUCTS } from '@/lib/analytics/catalogue';
import { identifyUser, optOutOfAnalytics, setAnalyticsForTests } from '@/lib/analytics/client';
import { fakePackage, purchasesMock, withProductId } from '@/test/purchases';
import { memoryStorage } from '@/test/memoryStorage';

import personas from '../fixtures/personas.json';

const MAYA = personas.personas.maya.id;

/** Product id sets an offering may carry (D60): Test Store now, stores later, legacy, nonsense. */
const ID_SETS = {
  testStore: {
    yearly: 'yearly_v2',
    monthly: 'monthly_v2',
    day3: 'yearly_day3_v2',
    exit30: 'yearly_exit30_v2',
  },
  stores: { yearly: 'yearly', monthly: 'monthly', day3: 'yearly_day3', exit30: 'yearly_exit30' },
  legacy: {
    yearly: 'yearly_trial',
    monthly: 'monthly_legacy_qa',
    day3: 'yearly_trial',
    exit30: 'yearly_trial',
  },
  // The labels must not come from the id at all: swap them around.
  swapped: {
    yearly: 'monthly_v2',
    monthly: 'yearly_exit30_v2',
    day3: 'yearly_v2',
    exit30: 'yearly_day3_v2',
  },
} as const;
type IdSet = (typeof ID_SETS)[keyof typeof ID_SETS];

/** Ids that must never reach PostHog (the vocabulary words themselves are allowed). */
const RAW_IDS = [
  'yearly_v2',
  'monthly_v2',
  'yearly_day3_v2',
  'yearly_exit30_v2',
  'yearly_trial',
  'monthly_legacy_qa',
];

function offeringsWith(ids: IdSet) {
  const annual = (id: string, intro: Parameters<typeof fakePackage>[3]) =>
    withProductId(fakePackage('$rc_annual', PACKAGE_TYPE.ANNUAL, 'Y-PRICE', intro, null, { price: 60 }), id);
  return {
    current: null,
    all: {
      default: {
        identifier: 'default',
        availablePackages: [
          withProductId(
            fakePackage('$rc_monthly', PACKAGE_TYPE.MONTHLY, 'M-PRICE', null, null, { price: 10 }),
            ids.monthly,
          ),
          annual(ids.yearly, { price: 0, unit: 'DAY', units: 7 }),
        ],
      },
      day3: {
        identifier: 'day3',
        availablePackages: [annual(ids.day3, { price: 30, unit: 'YEAR', units: 1, priceString: 'O-PRICE' })],
      },
      exit30: {
        identifier: 'exit30',
        availablePackages: [annual(ids.exit30, { price: 42, unit: 'YEAR', units: 1, priceString: 'X-PRICE' })],
      },
    },
  };
}

/** Where each offering is bought in the app (paywall id of the catalogue). */
const PAYWALL_OF: Record<OfferingId, '16' | '15'> = {
  default: '16',
  day3: '15',
  exit30: '16',
};
const EXPECTED: Record<OfferingId, Record<'yearly' | 'monthly', string>> = {
  default: { yearly: 'yearly', monthly: 'monthly' },
  day3: { yearly: 'yearly_day3', monthly: 'monthly' },
  exit30: { yearly: 'yearly_exit30', monthly: 'monthly' },
};

// ───────────── PostHog wire capture (same seam as privacy.test.ts) ─────────────

type Request = { url: string; body: string };
const g = globalThis as unknown as { __qaFetch?: typeof fetch };
let requests: Request[] = [];
let pending: Promise<void>[] = [];

async function bodyText(body: unknown): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  let bytes: Buffer;
  if (body instanceof Blob) bytes = Buffer.from(await body.arrayBuffer());
  else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
  else if (ArrayBuffer.isView(body)) bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  else return String(body);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return bytes.toString('utf8');
}

function installNetwork() {
  requests = [];
  pending = [];
  g.__qaFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    pending.push(bodyText(init?.body).then((body) => void requests.push({ url, body })));
    const payload = url.includes('/config') ? '{}' : '{"status":1}';
    return Promise.resolve(
      new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all(pending);
  }
}

type Sent = { event: string; properties: Record<string, unknown> };
function sentEvents(): Sent[] {
  return requests
    .filter((r) => r.body.startsWith('{') || r.body.startsWith('['))
    .flatMap((r) => {
      const parsed = JSON.parse(r.body) as { batch?: unknown[] } | unknown[];
      return (Array.isArray(parsed) ? parsed : (parsed.batch ?? [])) as Sent[];
    });
}

// ───────────── drive ─────────────

const PURCHASE_EVENTS = [
  'purchase_started',
  'purchase_cancelled',
  'purchase_failed',
  'purchase_completed',
] as const;

/** Every plan of every offering: started + cancelled, started + failed, started + completed. */
async function buyEverything(set: keyof typeof ID_SETS) {
  resetPurchasesForTests();
  resetPurchaseClockForTests();
  purchasesMock.getOfferings.mockResolvedValue(offeringsWith(ID_SETS[set]));
  purchasesMock.logIn.mockResolvedValue({ customerInfo: {}, created: false });
  const tagged: { set: string; offering: OfferingId; kind: 'yearly' | 'monthly' }[] = [];
  for (const offering of ['default', 'day3', 'exit30'] as const) {
    const loaded = await loadOffering(offering);
    expect(loaded?.plans.length).toBeGreaterThan(0);
    for (const plan of loaded!.plans) {
      const context = { paywall: PAYWALL_OF[offering], plan, offering };
      for (const outcomeOf of [
        () => Promise.reject({ code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR, userCancelled: true }),
        () => Promise.reject({ code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR }),
        () => Promise.resolve({ customerInfo: { entitlements: { active: { premium: {} } } } }),
      ]) {
        purchasesMock.purchasePackage.mockImplementationOnce(outcomeOf);
        trackPurchaseStarted(context);
        const outcome = await purchasePlan(offering, plan.id, MAYA);
        trackPurchaseOutcome(context, outcome, { isTrial: false, beforeSignIn: false });
      }
      tagged.push({ set, offering, kind: plan.kind });
    }
  }
  return tagged;
}

describe('QA-51 D60 product labels on the PostHog wire (real SDK, real purchases module)', () => {
  let events: Sent[];
  let wire: string;
  const bought: { set: string; offering: OfferingId; kind: 'yearly' | 'monthly' }[] = [];

  beforeAll(async () => {
    installNetwork();
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_xxxxxxxxxx';
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'test_xxxxxxxxxx';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    setAnalyticsForTests({ storage: memoryStorage() });
    // Fake low-entropy keys: any non-empty value turns the SDKs on in tests.
    // Signed in, so `plan` goes on the person (setPersonProperties needs an identified user).
    identifyUser(MAYA);
    for (const set of Object.keys(ID_SETS) as (keyof typeof ID_SETS)[]) {
      bought.push(...(await buyEverything(set)));
    }
    await optOutOfAnalytics(); // flushes the queue
    await settle();
    events = sentEvents().filter((e) => (PURCHASE_EVENTS as readonly string[]).includes(e.event));
    wire = requests.map((r) => `${r.url}\n${r.body}`).join('\n');
  }, 120_000);

  afterAll(() => {
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    delete g.__qaFetch;
    resetPurchasesForTests();
    setAnalyticsForTests({ storage: memoryStorage() });
    jest.restoreAllMocks();
  });

  it('positive control: every plan of every offering went through, and every purchase event is on the wire', () => {
    // 4 id sets x (default: yearly + monthly, day3: yearly, exit30: yearly).
    expect(bought).toHaveLength(Object.keys(ID_SETS).length * 4);
    expect(purchasesMock.purchasePackage).toHaveBeenCalledTimes(bought.length * 3);
    const names = new Set(events.map((e) => e.event));
    for (const name of PURCHASE_EVENTS) expect({ name, sent: names.has(name) }).toEqual({ name, sent: true });
    // started x3 + cancelled + failed + completed per plan.
    expect(events).toHaveLength(bought.length * 6);
  });

  it('every product label is a D60 vocabulary word', () => {
    expect([...PRODUCTS].sort()).toEqual(['monthly', 'yearly', 'yearly_day3', 'yearly_exit30']);
    const labels = new Set(events.map((e) => e.properties.product));
    for (const label of labels) expect(PRODUCTS as readonly unknown[]).toContain(label);
    expect([...labels].sort()).toEqual(['monthly', 'yearly', 'yearly_day3', 'yearly_exit30']);
  });

  it('the label follows offering + package type, whatever product ids the store returns', () => {
    // Events come out in the order the purchases ran: 6 per plan.
    for (const [i, b] of bought.entries()) {
      const mine = events.slice(i * 6, i * 6 + 6);
      const want = EXPECTED[b.offering][b.kind];
      expect({ ...b, labels: mine.map((e) => e.properties.product) }).toEqual({
        ...b,
        labels: Array(6).fill(want),
      });
      const started = mine.filter((e) => e.event === 'purchase_started');
      for (const e of started) expect(e.properties.offering).toBe(b.offering);
    }
  });

  it('no store product id anywhere on the wire (bodies and URLs)', () => {
    expect(wire.length).toBeGreaterThan(0);
    for (const id of RAW_IDS) expect({ id, onWire: wire.includes(id) }).toEqual({ id, onWire: false });
  });

  it('the person property `plan` is only yearly or monthly', () => {
    const plans = sentEvents()
      .flatMap((e) => [e.properties.$set, e.properties.$set_once])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => s.plan)
      .filter((p) => p !== undefined);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) expect(['yearly', 'monthly']).toContain(p);
  });
});
