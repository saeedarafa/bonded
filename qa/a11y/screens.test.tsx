// QA-07: every built screen, in its main states, through the real router (app/), with the fake
// server in world.ts. Per case:
//   light      a11y rules (checks.ts) + reveal rule + locked pack text + no unfaked api calls
//   light-200  the same rules at 200% text, plus no truncation of question/answer/message text
//   dark, and light/dark/200 for `snapshot` cases: a structure + style snapshot (serialise())
// Known product findings go in KNOWN with their GitHub issue; the test fails when one is fixed
// (stale entry), so the list only shrinks.
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { INTRO_ELIGIBILITY_STATUS } from 'react-native-purchases';

import { useAnalyticsConsent } from '@/features/analytics/useAnalytics';
import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSeenBadges } from '@/features/badges/seen';
import { ANSWER_UPSELL_FROM } from '@/features/daily/screens/AnswerScreen';
import { useLittleThingsSeen, useLittleThingsTip } from '@/features/littleThings/hooks';
import { usePendingSetup } from '@/features/onboarding/pendingSetup';
import { useOnboarding } from '@/features/onboarding/store';
import { clearHeldCancelOffer } from '@/features/premium/cancelOffer';
import { useOfferShown } from '@/features/premium/offers';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import { useMyInvite } from '@/features/pairing/hooks';
import { usePendingJoin } from '@/features/pairing/joinRequest';
import { setPushStorage } from '@/features/push/registration';
import { setSoftAskStorage } from '@/features/push/softAsk';
import { setReviewStorage } from '@/features/review/review';
import { useEndedSeen } from '@/features/settings/partnerLeft';
import { isOptedOut, setAnalyticsForTests } from '@/lib/analytics/client';
import { clearDrafts } from '@/lib/drafts';
import { cacheStorage, createKeyValueStorage } from '@/lib/storage';
import { memoryStorage } from '@/test/memoryStorage';
import { fakeOfferings, purchasesMock } from '@/test/purchases';

import { asNodes, serialise, textOf, walk, type Node } from '../visual/tree';
import {
  a11yFindings,
  lockedPackFindings,
  revealFindings,
  spokenStrings,
  truncationFindings,
} from './checks';
import { MODES, setMode, type Mode } from './mode';
import { ANSWER_UPSELL_FROM as UPSELL_FROM_CASES, CASES, type Case } from './screens';
import { ME, MY_ANSWER, PARTNER, PARTNER_ANSWER, resetWorld, time, world } from './world';

const APP_DIR = './app';

/**
 * Accepted product findings: "<screen id>/<state> <finding substring>" -> GitHub issue.
 * Each one is a filed bug; remove the line when it is fixed (a stale entry fails the run).
 */
export const KNOWN: Record<string, string> = {
};

const key = (c: Case) => `${c.id}/${c.state}`;

/**
 * QA-32: everything the app writes to the console during a case. Answer, reply and note text is
 * private (AGENTS.md: never in logs), and every fixture text starts with FIXTURE-, so a logged
 * FIXTURE- string is a finding in every case.
 */
const logged: string[] = [];
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug'] as const;
function captureConsole() {
  logged.length = 0;
  return CONSOLE.map((m) => {
    const original = console[m];
    const spy = jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : safeJson(a))).join(' '));
      original(...(args as []));
    });
    return spy;
  });
}
function safeJson(a: unknown) {
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}
const loggedTextFindings = () =>
  logged.filter((l) => l.includes('FIXTURE-')).map((l) => `fixture text logged: ${l.slice(0, 80)}`);

/** The little-things stores' own storage (same prefix as src/features/littleThings/hooks.ts). */
const littleThingsStorage = createKeyValueStorage('littlethings:');

function resetClient() {
  // The persisted query cache (MMKV) outlives a render: a previous case's throttled write can land
  // while a later case advances the clock, and the next mount would restore that case's couple as
  // fresh data. Every case starts from an empty cache, as on a clean install.
  cacheStorage.removeItem('query-cache');
  useOnboarding.getState().reset();
  // MOB-61: T1's answer and N's time live in their own (persisted) store.
  usePendingSetup.getState().reset();
  usePendingInvite.getState().clear();
  useMyInvite.getState().set(null);
  usePendingJoin.getState().clear();
  useSeenBadges.setState({ seen: [] });
  // MOB-64: 14 opens by itself at most once per phone (persisted ids).
  useOfferShown.setState({ shown: [] });
  // QA-52 (MOB-84): the offer Us cleared is held in memory for the cancel offer screen; drop it.
  clearHeldCancelOffer();
  useEndedSeen.setState({ seen: [] });
  clearDrafts();
  // QA-29 (MOB-58/59): the 24b tip shows once per phone; a 24d moment plays once per phone (the
  // newest gesture acted out is persisted per person). Every case starts as a phone that has seen
  // the tip and no gesture yet; cases that want the tip turn it back on.
  useLittleThingsTip.setState({ seen: true });
  for (const u of [ME, PARTNER]) littleThingsStorage.removeItem(`seenAt:${u}`);
  useLittleThingsSeen.setState({ seen: {}, moment: null });
  // QA-29 (MOB-55/56): expo-audio's stand-in (src/test/setup.ts) is shared: microphone allowed,
  // no recorders or players left from the previous case.
  const audio = (jest.requireMock('expo-audio') as { __audio: { permission: boolean; recorders: unknown[]; players: unknown[] } }).__audio;
  audio.permission = true;
  audio.recorders.length = 0;
  audio.players.length = 0;
  setSoftAskStorage(memoryStorage());
  setPushStorage(memoryStorage());
  setReviewStorage(memoryStorage());
  // MOB-24b (D54): "Share usage data" is on by default; the opt-out is stored on the phone, so every
  // case starts from a clean store with sharing on (40/share-usage-off turns it off).
  setAnalyticsForTests({ storage: memoryStorage() });
  useAnalyticsConsent.setState({ sharing: true });
}

/**
 * Let queries resolve and effects settle. renderRouter() switches Jest to fake timers (and pins
 * the clock to Date.now(), which setup.ts fixes at NOW), so time is advanced, not waited for.
 */
async function settle() {
  for (let i = 0; i < 4; i++) await act(() => jest.advanceTimersByTimeAsync(20));
}

/**
 * RevenueCat for this case (world.store): a key on this build plus the `default` offering, or no
 * key at all. The SDK module caches its configuration, so it is reset every case.
 */
function applyStore() {
  resetPurchasesForTests();
  purchasesMock.getCustomerInfo.mockResolvedValue({ entitlements: { active: {} } });
  purchasesMock.getProducts.mockResolvedValue([]);
  purchasesMock.getPromotionalOffer.mockResolvedValue(undefined);
  if (!world.store) {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    return;
  }
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  const eligible = { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE };
  purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
    ...(world.store.trialEligible ? { product$rc_annual: eligible } : {}),
  });
  // QA-48b (D57 (2)): the cancel offer on my own App Store yearly plan, or nothing (the default).
  if (world.store.cancelOffer) {
    const product = {
      identifier: 'yearly_v2',
      price: 60,
      priceString: 'Y-PRICE',
      subscriptionPeriod: 'P1Y',
      discounts: [{ identifier: 'cancel30', price: 42, priceString: 'C-PRICE' }],
    };
    purchasesMock.getCustomerInfo.mockResolvedValue({
      entitlements: { active: { premium: { store: 'APP_STORE', productIdentifier: 'yearly_v2' } } },
    });
    purchasesMock.getProducts.mockResolvedValue([product]);
    purchasesMock.getPromotionalOffer.mockResolvedValue({ identifier: 'cancel30', signature: 's' });
  }
}

async function show(c: Case, m: Mode): Promise<Node[]> {
  setMode(m);
  resetWorld();
  c.world?.(world);
  applyStore();
  resetClient();
  c.client?.();
  // QA-34: renderRouter() pins its fake clock to Date.now(), which after the first case is the
  // previous case's fake clock, so time leaked across cases (18's "New in" countdown depended on
  // how many cases ran before it). Real timers first: Date.now() is NOW again (setup.ts).
  jest.useRealTimers();
  await renderRouter(APP_DIR, { initialUrl: c.url });
  await screen.findByTestId(c.expect ?? `${c.id}-screen`, {}, { timeout: 8000 });
  await settle();
  if (c.act) {
    await c.act();
    if (c.ready) await screen.findByTestId(c.ready, {}, { timeout: 8000 });
    await settle();
  }
  return asNodes(screen.toJSON());
}

function check(c: Case, found: string[]) {
  const mine = Object.entries(KNOWN).filter(([k]) => k.startsWith(`${key(c)} `));
  const fresh = found.filter((f) => !mine.some(([k]) => f.includes(k.slice(key(c).length + 1))));
  return { fresh, known: mine.filter(([k]) => found.some((f) => f.includes(k.slice(key(c).length + 1)))) };
}

const seenKnown = new Set<string>();
/** Cases whose rule check ran (a -t filter runs a subset). */
const ranRules = new Set<string>();

describe.each(CASES.map((c) => [`${c.id} ${c.state}`, c] as const))('%s', (_name, c) => {
  let spies: jest.SpyInstance[] = [];
  beforeEach(() => {
    spies = captureConsole();
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  for (const m of MODES.filter((x) => x.name !== 'dark')) {
    it(`a11y rules in ${m.name}`, async () => {
      const tree = await show(c, m);
      const found = [
        ...a11yFindings(tree, { noHeading: !!c.noHeading }),
        ...(c.beforeReveal ? revealFindings(tree) : []),
        ...(c.lockedPack ? lockedPackFindings(tree) : []),
        ...(c.noAnswerText
          ? world.textReads.map((id) => `answer text requested for ${id} where none may be read (noAnswerText)`)
          : []),
        ...(c.noArchiveReads
          ? world.archiveReads.map((r) => `ended archive read (${r}) after its 30 days (D08)`)
          : []),
        ...(c.present ?? [])
          .filter((id) => !screen.queryByTestId(id))
          .map((id) => `must render: ${id}`),
        ...(c.absent ?? [])
          .filter((id) => screen.queryByTestId(id))
          .map((id) => `must not render: ${id}`),
        ...(m.fontScale > 1
          ? truncationFindings(tree, [MY_ANSWER, PARTNER_ANSWER, 'FIXTURE-MSG', 'question'])
          : []),
        ...loggedTextFindings(),
        ...world.unfaked.map((u) => `unfaked: ${u} (add a fake in qa/a11y/world.ts)`),
      ];
      const allowed = Object.keys(c.allow ?? {});
      const { fresh, known } = check(
        c,
        found.filter((f) => !allowed.some((a) => f.includes(a))),
      );
      known.forEach(([k]) => seenKnown.add(k));
      ranRules.add(key(c));
      expect(fresh).toEqual([]);
    });
  }

  if (c.snapshot) {
    for (const m of MODES) {
      it(`structure snapshot in ${m.name}`, async () => {
        const tree = await show(c, m);
        expect(serialise(tree)).toMatchSnapshot();
      });
    }
  }
});

describe('positive controls (the checks can fail)', () => {
  it('21 after the hold does show the partner answer, so revealFindings would catch it early', async () => {
    const c = CASES.find((x) => x.id === '21')!;
    const tree = await show(c, MODES[0]!);
    expect(revealFindings(tree).length).toBeGreaterThan(0);
    expect(spokenStrings(tree).some((s) => s.includes('FIXTURE-PARTNER-ANSWER'))).toBe(true);
  });

  it('21 for a pack question requests the answer text, so noAnswerText would catch an early read', async () => {
    const c = CASES.find((x) => x.id === '21' && x.state === 'pack-revealed')!;
    const tree = await show(c, MODES[0]!);
    expect(world.textReads.length).toBeGreaterThan(0);
    expect(spokenStrings(tree).some((s) => s.includes('FIXTURE-PARTNER-ANSWER'))).toBe(true);
  });

  it('30 ended-both shows the partner answer and asks for text, so the ended reveal checks can fail', async () => {
    const c = CASES.find((x) => x.id === '30' && x.state === 'ended-both')!;
    const tree = await show(c, MODES[0]!);
    expect(revealFindings(tree).length).toBeGreaterThan(0);
    expect(world.textReads).toContain('cq-e1');
    expect(world.archiveReads.length).toBeGreaterThan(0);
  });

  it('31 full requests and shows the loved answer text, so the free and loved-hidden checks can fail', async () => {
    const c = CASES.find((x) => x.id === '31' && x.state === 'full')!;
    const tree = await show(c, MODES[0]!);
    expect(world.textReads).toContain('a-loved');
    expect(revealFindings(tree).length).toBeGreaterThan(0);
  });

  it('33 for a premium couple shows the premium question text that the free case must hide', async () => {
    const c = CASES.find((x) => x.id === '33' && x.state === 'premium')!;
    const tree = await show(c, MODES[0]!);
    expect(lockedPackFindings(tree).length).toBeGreaterThan(0);
  });

  it('33 free-started shows only the started question and the sample, no other locked text (D51)', async () => {
    const c = CASES.find((x) => x.id === '33' && x.state === 'free-started')!;
    const tree = await show(c, MODES[0]!);
    const shown = lockedPackFindings(tree).join('\n');
    expect(shown).toContain('FIXTURE-LOCKED-Q-3');
    for (const n of [2, 4, 5, 6]) expect(shown).not.toContain(`FIXTURE-LOCKED-Q-${n}`);
  });
});

describe('17 exit sheet main button (D52, QA-33)', () => {
  const find = (state: string) => CASES.find((x) => x.id === '17' && x.state === state)!;

  it('trial-eligible: "Try Premium free for 7 days" (the store trial length)', async () => {
    const spoken = spokenStrings(await show(find('trial'), MODES[0]!));
    expect(spoken.some((s) => s.includes('Try Premium free for 7 days'))).toBe(true);
  });

  it('not eligible: "Get Premium", no trial words', async () => {
    const spoken = spokenStrings(await show(find('get-premium'), MODES[0]!));
    expect(spoken).toContain('Get Premium');
    expect(spoken.some((s) => /free for \d|trial/i.test(s))).toBe(false);
  });
});

describe('D61 cancel offer only; no offer on a paywall × (MOB-84, QA-52)', () => {
  const find = (id: string, state: string) => CASES.find((x) => x.id === id && x.state === state)!;
  const pressNow = async (id: string) => {
    await act(async () => fireEvent.press(screen.getByTestId(id)));
    await settle();
  };

  it('P3 ×: straight to 08, no 17, no offer, the server is never asked', async () => {
    await show(find('P3', 'exit'), MODES[0]!);
    expect(screen.queryByTestId('17-sheet')).toBeNull();
    expect(screen.queryByTestId('cancel-offer-screen')).toBeNull();
    expect(world.exitOfferOpens).toEqual([]);
  });

  it('16 × even with the server willing (paywall_close): 17, the server is never asked', async () => {
    const c = CASES.find((x) => x.id === '17' && x.state === 'get-premium')!;
    await show({ ...c, world: (w) => { c.world?.(w); w.exitOffers = { paywall_close: true, cancel: true }; } }, MODES[0]!);
    expect(world.exitOfferOpens).toEqual([]);
    expect(screen.queryByTestId('cancel-offer-screen')).toBeNull();
  });

  it('40 cancel offer: real store prices, "Continue to cancel" opens the store page at once', async () => {
    const { Linking } = require('react-native') as typeof import('react-native'); // eslint-disable-line @typescript-eslint/no-require-imports
    const open = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());
    try {
      const spoken = spokenStrings(await show(find('40', 'cancel-offer'), MODES[0]!));
      expect(world.exitOfferOpens).toEqual(['cancel']);
      expect(spoken.some((x) => x.includes('C-PRICE') && x.includes('Y-PRICE'))).toBe(true);
      expect(open).not.toHaveBeenCalled();
      await pressNow('cancel-offer-continue');
      expect(open).toHaveBeenCalledTimes(1);
      expect(String(open.mock.calls[0]![0])).toMatch(/apps\.apple\.com\/account\/subscriptions/);
    } finally {
      open.mockRestore();
    }
  });

  it('40 × on the cancel offer: back to 40, nothing bought, server asked once', async () => {
    await show(find('40', 'cancel-offer'), MODES[0]!);
    const bought = purchasesMock.purchasePackage.mock.calls.length;
    await pressNow('cancel-offer-close');
    await screen.findByTestId('40-screen', {}, { timeout: 8000 });
    expect(screen.queryByTestId('cancel-offer-screen')).toBeNull();
    expect(world.exitOfferOpens).toEqual(['cancel']);
    expect(purchasesMock.purchasePackage.mock.calls.length).toBe(bought);
  });

  it('push path: the screen asks the gate itself (once) and shows the store prices', async () => {
    const spoken = spokenStrings(await show(find('40', 'cancel-offer-push'), MODES[0]!));
    expect(world.exitOfferOpens).toEqual(['cancel']);
    expect(spoken.some((x) => x.includes('C-PRICE') && x.includes('Y-PRICE'))).toBe(true);
  });

  it('push path, shown before (server says no): no offer screen, the store page opens', async () => {
    const { Linking } = require('react-native') as typeof import('react-native'); // eslint-disable-line @typescript-eslint/no-require-imports
    const open = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());
    try {
      const c = find('40', 'cancel-offer-push');
      await show({ ...c, world: (w) => { c.world!(w); w.exitOffers = {}; }, expect: '40-screen', present: [] }, MODES[0]!);
      await settle();
      expect(world.exitOfferOpens).toEqual(['cancel']);
      expect(screen.queryByTestId('cancel-offer-title')).toBeNull();
      expect(open).toHaveBeenCalled();
      expect(String(open.mock.calls[0]![0])).toMatch(/apps\.apple\.com\/account\/subscriptions/);
    } finally {
      open.mockRestore();
    }
  });
});

describe('D52 day-3 gift (MOB-64, QA-34)', () => {
  const find = (id: string, state: string) => CASES.find((x) => x.id === id && x.state === state)!;

  it('14 by itself starts nothing: no open_offer, no claim (only Today claims)', async () => {
    await show(find('14', 'unopened'), MODES[0]!);
    expect(world.offerOpens).toEqual([]);
    expect(world.offerScreenClaims).toEqual([]);
  });

  it('14 "Not now" starts no clock', async () => {
    await show(find('14', 'unopened'), MODES[0]!);
    // Back on Today the day's full-screen offer is used up (else Today would claim and reopen 14).
    world.offerScreenFree = false;
    await act(async () => fireEvent.press(screen.getByTestId('14-later')));
    await settle();
    expect(screen.getByTestId('today-gift-chip')).toBeTruthy();
    expect(world.offerOpens).toEqual([]);
    expect(world.offers.day3!.expires_at).toBeNull();
  });

  it('14 "Open the gift" calls open_offer once and lands on 15 with the 12-hour clock', async () => {
    await show(find('14', 'open'), MODES[0]!);
    expect(world.offerOpens).toEqual(['day3']);
    expect(screen.getByTestId('15-countdown')).toBeTruthy();
    expect(spokenStrings(asNodes(screen.toJSON())).some((x) => /\b1[12] hours?\b|1[12]:\d\d/.test(x))).toBe(true);
  });

  it('Today opens 14 by itself only after claim_offer_screen("gift") says yes', async () => {
    await show(find('14', 'from-today'), MODES[0]!);
    expect(world.offerScreenClaims).toEqual(['gift']);
    expect(world.offerOpens).toEqual([]);
  });

  it('claim refused: Today stays, the chip leads to 14, no clock started', async () => {
    await show(find('18', 'gift-unopened'), MODES[0]!);
    expect(world.offerScreenClaims).toEqual(['gift']);
    expect(screen.queryByTestId('14-screen')).toBeNull();
    expect(world.offerOpens).toEqual([]);
  });

  it('opened: the chip counts down from the server clock (expires_at - server_now = 11 h)', async () => {
    const nodes = await show(find('18', 'gift-opened'), MODES[0]!);
    expect(spokenStrings(nodes).some((x) => /11 hours/.test(x))).toBe(true);
    expect(world.offerScreenClaims).toEqual([]);
  });

  it('ended: no countdown, no claim button, no "last chance"', async () => {
    const nodes = await show(find('15', 'ended'), MODES[0]!);
    expect(spokenStrings(nodes).some((x) => /last chance/i.test(x))).toBe(false);
  });
});

describe('19d free answer hint (D46, MOB-54a, QA-35)', () => {
  const find = (id: string, state: string) => CASES.find((x) => x.id === id && x.state === state)!;
  const hint = () => screen.queryByTestId('19d-upsell');

  it('the cases start where the app does (450)', () => {
    expect(UPSELL_FROM_CASES).toBe(ANSWER_UPSELL_FROM);
  });

  it('free at 449: no offer on plain 19', async () => {
    await show(find('19', 'free-449'), MODES[0]!);
    expect(hint()).toBeNull();
  });

  it('free at 450: "50 left. Premium: 2000", spoken as characters left', async () => {
    const nodes = await show(find('19d', 'near-limit'), MODES[0]!);
    const spoken = spokenStrings(nodes);
    expect(spoken.some((x) => /^50 left\. Premium: 2000$/.test(x))).toBe(true);
    expect(spoken.some((x) => /50 characters left.*2000/.test(x))).toBe(true);
  });

  it('free at 500: "0 left. Premium: 2000"', async () => {
    const spoken = spokenStrings(await show(find('19d', 'at-limit'), MODES[0]!));
    expect(spoken.some((x) => /^0 left\. Premium: 2000$/.test(x))).toBe(true);
  });

  it('typing past 449 brings the hint, deleting back below 450 removes it', async () => {
    await show(find('19', 'free-449'), MODES[0]!);
    const field = screen.getByTestId('19-field');
    await act(async () => fireEvent.changeText(field, 'y'.repeat(ANSWER_UPSELL_FROM)));
    await settle();
    expect(hint()).toBeTruthy();
    await act(async () => fireEvent.changeText(field, 'y'.repeat(ANSWER_UPSELL_FROM - 1)));
    await settle();
    expect(hint()).toBeNull();
  });

  it('tapping the hint opens paywall 16 (from the answer), and saves nothing', async () => {
    await show(find('19d', 'paywall'), MODES[0]!);
    expect(screen.getByTestId('16-screen')).toBeTruthy();
    expect(world.answers[ME]).toBeUndefined();
  });

  it('Premium at 1500: no hint, the field allows 2000', async () => {
    await show(find('19', 'premium-long'), MODES[0]!);
    expect(hint()).toBeNull();
    expect(screen.getByTestId('19-field')).toBeTruthy();
  });
});

describe('D50 onboarding copy and progress (MOB-60, QA-34)', () => {
  const STAGES = ['dating', 'living_together', 'engaged_married', 'long_distance'];
  const find = (id: string, state = 'default') =>
    CASES.find((x) => x.id === id && x.state === state)!;
  const spokenIn = async (id: string, state?: string) =>
    spokenStrings(await show(find(id, state), MODES[0]!));

  it.each([
    ['05', 1],
    ['07', 2],
    ['03', 3],
    ['06', 4],
  ])('%s is quiz step %i of 4', async (id, n) => {
    expect(await spokenIn(id as string)).toContain(`Step ${n} of 4`);
  });

  it('02, 04, 47 and 08 show no step', async () => {
    for (const id of ['02', '04', '47', '08']) {
      expect((await spokenIn(id)).some((s) => /^Step \d of \d$/.test(s))).toBe(false);
    }
  });

  it('05: only the picked tile has its check mark (hidden from screen readers)', async () => {
    const hidden = { includeHiddenElements: true };
    await show(find('05'), MODES[0]!);
    for (const s of STAGES) expect(screen.queryByTestId(`05-${s}-check`, hidden)).toBeNull();
    await show(find('05', 'picked'), MODES[0]!);
    expect(screen.queryByTestId('05-long_distance-check', hidden)).not.toBeNull();
    for (const s of STAGES.filter((x) => x !== 'long_distance')) {
      expect(screen.queryByTestId(`05-${s}-check`, hidden)).toBeNull();
    }
  });

  it('02: four different titles, each body names the partner from 07', async () => {
    const titles = new Set<string>();
    for (const stage of STAGES) {
      const spoken = await spokenIn('02', stage);
      expect(spoken.some((s) => s.includes('You and Ari '))).toBe(true);
      titles.add(spoken.find((s) => /^(Life gets|Miles get) /.test(s)) ?? '');
    }
    expect([...titles].filter(Boolean)).toHaveLength(4);
  });

  it('03 names the partner in the title and the privacy line', async () => {
    const spoken = await spokenIn('03');
    expect(spoken.some((s) => s.includes('something new about Ari?'))).toBe(true);
    expect(spoken.some((s) => s.includes('Ari never sees this'))).toBe(true);
  });

  it('04 payoff cards carry both names', async () => {
    const spoken = (await spokenIn('04')).join('\n');
    expect(spoken).toContain('Ari');
    expect(spoken).toContain('Noor');
  });

  it('06 summary lists the picks in the board order, not the tap order', async () => {
    expect(await spokenIn('06', 'picked')).toContain(
      '3 picked. We’ll start with deep talks, laughs and learning about each other.',
    );
  });
});

describe('58 history PDF export (MOB-27, QA-32)', () => {
  const find = (state: string) => CASES.find((x) => x.id === '58' && x.state === state)!;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const print = () => jest.requireMock('expo-print') as { printToFileAsync: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharing = () => jest.requireMock('expo-sharing') as { shareAsync: jest.Mock };
  let spies: jest.SpyInstance[] = [];
  beforeEach(() => {
    print().printToFileAsync.mockClear();
    sharing().shareAsync.mockClear();
    spies = captureConsole();
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  it('positive control: a logged fixture string is caught', () => {
    console.debug('qa/a11y positive control FIXTURE-MY-ANSWER');
    expect(loggedTextFindings()).toHaveLength(1);
    logged.length = 0;
  });

  it('exporting: the card says busy, a second tap does not start another export', async () => {
    const c = find('exporting');
    await show(c, MODES[0]!);
    const card = screen.getByTestId('58-download');
    expect(card.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByTestId('58-download-caption')).toHaveTextContent('Making your PDF…');
    await act(async () => fireEvent.press(card));
    expect(world.exportReads).toEqual(['couple-ended']);
    expect(print().printToFileAsync).not.toHaveBeenCalled();
  });

  it('export-failed: our copy in the banner, the card stays tappable to try again', async () => {
    const c = find('export-failed');
    await show(c, MODES[0]!);
    expect(screen.getByTestId('58-download-error')).toHaveTextContent("We couldn't make the PDF. Try again.");
    expect(screen.getByTestId('58-download').props.accessibilityState).toMatchObject({ busy: false });
    expect(print().printToFileAsync).not.toHaveBeenCalled();
  });

  it('print-failed: the text went only to expo-print, never to the tree, the banner or a log', async () => {
    const c = find('print-failed');
    const tree = await show(c, MODES[0]!);
    const html = String(print().printToFileAsync.mock.calls[0]?.[0]?.html ?? '');
    // Positive control: the PDF did get both answers (so the checks below could have failed).
    expect(html).toContain('FIXTURE-MY-ANSWER');
    expect(html).toContain('FIXTURE-PARTNER-ANSWER');
    expect(sharing().shareAsync).not.toHaveBeenCalled();
    expect(spokenStrings(tree).filter((s) => s.includes('FIXTURE-'))).toEqual([]);
    expect(screen.getByTestId('58-download-error')).not.toHaveTextContent(/FIXTURE-|file:/);
    expect(logged.filter((l) => l.includes('FIXTURE-'))).toEqual([]);
  });

  it('success: the PDF goes to the share sheet, no banner, nothing logged', async () => {
    const c = find('print-failed');
    const succeeds = (w: typeof world) => {
      c.world!(w);
      w.printFails = false;
    };
    await show({ ...c, world: succeeds, ready: undefined }, MODES[0]!);
    await act(() => jest.advanceTimersByTimeAsync(100));
    expect(sharing().shareAsync).toHaveBeenCalledWith(
      'file:///cache/Print/history.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
    expect(screen.queryByTestId('58-download-error')).toBeNull();
    expect(logged.filter((l) => l.includes('FIXTURE-'))).toEqual([]);
  });
});

describe('closed ended archive has a header (MOB-52)', () => {
  it.each([
    ['29', 'ended-closed-title'],
    ['30', 'ended-q-closed-title'],
  ])('%s ended-closed shows %s as a header', async (id, title) => {
    const c = CASES.find((x) => x.id === id && x.state === 'ended-closed')!;
    await show(c, MODES[0]!);
    const h = screen.getByTestId(title);
    expect(h.props.accessibilityRole).toBe('header');
    expect(world.archiveReads).toEqual([]);
  });
});

describe('ended couple note with the real date (MOB-70, D08, QA-39)', () => {
  const find = (id: string, state: string) => CASES.find((x) => x.id === id && x.state === state)!;
  const byId = (tree: Node[], id: string) => {
    const hits: Node[] = [];
    walk(tree, (n) => {
      if (n.props?.testID === id) hits.push(n);
    });
    return hits;
  };
  // endedArchive(2): ended_at = NOW - 2 days (2026-11-08 09:00Z), so the last day is ended_at + 30.
  const sentence = (date: string) => `You can read these until ${date}. After that they're deleted.`;

  it.each([
    ['29', 'ended-list', 'ended-note'],
    ['30', 'ended-both', 'ended-q-note'],
  ] as const)('%s %s: %s is one element read as one sentence, in light and at 200%%', async (id, state, note) => {
    for (const m of [MODES[0]!, MODES[2]!]) {
      const tree = await show(find(id, state), m);
      const [box] = byId(tree, note);
      expect(box).toBeDefined();
      expect(box!.props.accessible).toBe(true);
      expect(box!.props.accessibilityRole).toBe('text');
      expect(box!.props.accessibilityLabel).toBe(sentence('Dec 8'));
      const [text] = byId(tree, `${note}-text`);
      // What is drawn is what is read; never cut short at 200%.
      expect(textOf(text!)).toBe(sentence('Dec 8'));
      expect(text!.props.numberOfLines).toBeUndefined();
      // The date is not spoken anywhere else (the intro no longer carries it).
      expect(spokenStrings(tree).filter((s) => s.includes('Dec 8'))).toEqual([
        sentence('Dec 8'),
        sentence('Dec 8'),
      ]);
    }
    if (id === '29')
      expect(screen.getByTestId('ended-until')).toHaveTextContent(
        'Your bond has ended. Your answers stay here, read-only.',
      );
  });

  it('the date follows ended_at: ended 29 days ago reads "until Nov 11", not 30 days from today', async () => {
    const base = find('29', 'ended-list');
    const tree = await show(
      {
        ...base,
        world: (w) => {
          base.world!(w);
          (w.endedCouple as { ended_at: string }).ended_at = time.iso(-29);
        },
      },
      MODES[0]!,
    );
    expect(byId(tree, 'ended-note')[0]!.props.accessibilityLabel).toBe(sentence('Nov 11'));
  });

  it.each([
    ['29', 'ended-note'],
    ['30', 'ended-q-note'],
  ])('%s ended-closed (31 days): no note, nothing read', async (id, note) => {
    const tree = await show(find(id, 'ended-closed'), MODES[0]!);
    expect(byId(tree, note)).toEqual([]);
    expect(world.archiveReads).toEqual([]);
  });
});

describe('D55 History is Premium beyond yesterday (MOB-71, QA-39)', () => {
  const find = (id: string, state: string) => CASES.find((x) => x.id === id && x.state === state)!;
  const light = MODES[0]!;
  let spies: jest.SpyInstance[] = [];
  beforeEach(() => {
    spies = captureConsole();
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));
  const fixtureSpoken = (tree: Node[]) => spokenStrings(tree).filter((s) => s.includes('FIXTURE-'));

  it('29 free: a locked row is a button that says locked and Premium; an open row does not', async () => {
    await show(find('29', 'locked-free'), light);
    const locked = screen.getByTestId('29-row-cq-2');
    expect(locked.props.accessibilityRole).toBe('button');
    expect(locked.props.accessibilityLabel).toMatch(/History question 2\? Answers locked\. Premium\.$/);
    expect(screen.getByTestId('29-row-cq-2-locked')).toHaveTextContent('Premium');
    expect(screen.getByTestId('29-row-cq-1').props.accessibilityLabel).not.toMatch(/locked|Premium/);
  });

  it('29 free: tapping a locked day opens 16 headed "Unlock all your history with Premium", not the day', async () => {
    await show(find('29', 'locked-tap'), light);
    expect(screen.getByTestId('16-title')).toHaveTextContent('Unlock all your history with Premium');
    expect(world.textReads).toEqual([]);
  });

  it('16 from=history: the History title, not the partner one', async () => {
    await show(find('16', 'from-history'), light);
    expect(screen.getByTestId('16-title')).toHaveTextContent('Unlock all your history with Premium');
    expect(screen.getByTestId('16-title').props.accessibilityRole).toBe('header');
  });

  it('30 locked: both cards say locked and Premium, no text was asked for or shown', async () => {
    const tree = await show(find('30', 'locked'), light);
    expect(screen.getByTestId('30-partner-premium')).toHaveTextContent(/Premium/);
    const labels = spokenStrings(tree);
    expect(labels).toEqual(expect.arrayContaining(["Sam's answer, locked. Premium.", 'Your answer, locked. Premium.']));
    expect(screen.getByTestId('30-unlock-body')).toHaveTextContent(
      'Today and yesterday are free. Every day before that is kept for you with Premium.',
    );
    expect(world.textReads).toEqual([]);
    expect(fixtureSpoken(tree)).toEqual([]);
  });

  it('30 Premium: the same older day opens (both answers), positive control for the locked case', async () => {
    const tree = await show(find('30', 'premium-older'), light);
    expect(world.textReads).toContain('cq-2');
    expect(JSON.stringify(tree)).toContain(PARTNER_ANSWER);
  });

  it('22 locked: the older day\'s thread is not read, no composer, the way out is 16', async () => {
    const tree = await show(find('22', 'locked'), light);
    expect(world.textReads).toEqual([]);
    expect(JSON.stringify(tree)).not.toContain('FIXTURE-MSG');
    await act(async () => fireEvent.press(screen.getByTestId('22-unlock-cta')));
    await screen.findByTestId('16-screen', {}, { timeout: 8000 });
    expect(screen.getByTestId('16-title')).toHaveTextContent('Unlock all your history with Premium');
  });

  it('ended archive, free reader: the list keeps the MOB-70 note; a locked day reads no text and leads to 16', async () => {
    await show(find('29', 'ended-locked'), light);
    expect(screen.getByTestId('ended-note')).toBeTruthy();
    expect(screen.getByTestId('ended-row-cq-e1').props.accessibilityLabel).toMatch(/Answers locked\. Premium\.$/);
    const tree = await show(find('30', 'ended-locked'), light);
    expect(world.textReads).toEqual([]);
    expect(fixtureSpoken(tree)).toEqual([]);
    await act(async () => fireEvent.press(screen.getByTestId('ended-q-unlock-cta')));
    await screen.findByTestId('16-screen', {}, { timeout: 8000 });
    expect(screen.getByTestId('16-title')).toHaveTextContent('Unlock all your history with Premium');
  });

  it('17 in a build that ships D55: "History: Last 2 days / Everything", spoken as one row', async () => {
    await show(find('17', 'history-row-shipped'), light);
    expect(screen.getByTestId('17-row-premiumHistory').props.accessibilityLabel).toBe(
      'History: free Last 2 days, Premium Everything',
    );
  });

  it('17 in a production build (flag off): no History row', async () => {
    await show(find('17', 'history-row-off'), light);
    expect(screen.queryByTestId('17-row-premiumHistory')).toBeNull();
  });

  it('58 PDF of an archive read without Premium: only the open day, plus how many need Premium', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const print = jest.requireMock('expo-print') as { printToFileAsync: jest.Mock };
    print.printToFileAsync.mockClear();
    await show(find('58', 'export-locked'), light);
    await act(() => jest.advanceTimersByTimeAsync(100));
    expect(world.exportReads).toEqual(['couple-ended']);
    const html = String(print.printToFileAsync.mock.calls[0]?.[0]?.html ?? '');
    expect(html).toContain('Ended question 1?');
    expect(html).toContain(MY_ANSWER);
    expect(html).not.toContain('Ended question 2?');
    expect(html).toMatch(/1 older day needs Premium, so it isn(&#39;|&#x27;|')t in this PDF\./);
    expect(logged.filter((l) => l.includes('FIXTURE-'))).toEqual([]);
  });
});

afterAll(() => {
  // A KNOWN entry nobody matched is a fixed bug (or a renamed case): remove it.
  const stale = Object.keys(KNOWN).filter((k) => ranRules.has(k.split(' ')[0]!) && !seenKnown.has(k));
  if (stale.length)
    throw new Error(`stale KNOWN entries (fixed?): ${stale.join(' | ')}`);
});

describe('new UI: voice and little things (D46, D48; MOB-54..59, QA-29)', () => {
  const find = (id: string, state: string) => CASES.find((x) => x.id === id && x.state === state)!;
  const light = MODES[0]!;
  let spies: jest.SpyInstance[] = [];
  beforeEach(() => {
    spies = captureConsole();
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  it('a production build (nothing shipped): no little-things button, no Write | Voice, no mic', async () => {
    await show(find('18', 'your-turn'), light);
    expect(screen.queryByTestId('24b-button')).toBeNull();
    await show(find('19', 'default'), light);
    expect(screen.queryByTestId('19-switch')).toBeNull();
    await show(find('22', 'messages'), light);
    expect(screen.queryByTestId('22b-mic')).toBeNull();
    expect(screen.queryByTestId('22b-mic-premium')).toBeNull();
  });

  it('19 free: Voice says Premium (spoken "Voice answer, Premium") and records nothing', async () => {
    await show(find('19', 'voice-free'), light);
    expect(screen.getByTestId('19-tab-voice').props.accessibilityLabel).toBe('Voice answer, Premium');
    expect(screen.getByTestId('19-tab-write').props.accessibilityState).toMatchObject({ selected: true });
    await show(find('19', 'voice-free-paywall'), light);
    expect(world.voiceUploads).toEqual([]);
  });

  it('19c Premium: a recorded take shows its length and can be deleted; no upload before Send', async () => {
    await show(find('19c', 'recorded'), light);
    expect(screen.getByTestId('19c-preview-time')).toHaveTextContent('0:42');
    expect(screen.getByTestId('19c-delete').props.accessibilityLabel).toBe('Delete voice answer');
    expect(world.voiceUploads).toEqual([]);
  });

  it('22b free: Sam\'s voice message is playable (listen-only plan), the mic leads to Premium', async () => {
    await show(find('22b', 'free'), light);
    expect(screen.getByTestId('22b-voice-c1-play').props.accessibilityLabel).toBe('Play voice message, 0:18');
    expect(screen.getByTestId('22b-mic-premium').props.accessibilityLabel).toBe('Record voice message, Premium');
    expect(screen.getByTestId('22b-free-note')).toHaveTextContent('Voice messages are for Premium couples. Anyone can listen.');
  });

  it('24c free kiss limit: "More kisses with Premium" on the item, spoken with the Premium hint', async () => {
    await show(find('24c', 'free-kiss-limit'), light);
    const kiss = screen.getByTestId('24c-kiss');
    expect(kiss).toHaveTextContent('More kisses with Premium');
    expect(kiss.props.accessibilityLabel).toContain('More kisses with Premium');
    expect(kiss.props.accessibilityHint).toBeTruthy();
    // The other kinds are not at their limit.
    expect(screen.getByTestId('24c-hug').props.accessibilityLabel).toBe('Hug');
    expect(world.littleThingsSent).toEqual([]);
  });

  it('24c: goodnight sends once with amount 1, the toast names Sam, Undo takes it back', async () => {
    await show(find('24c', 'undo-toast'), light);
    expect(world.littleThingsSent).toEqual([{ kind: 'goodnight', amount: 1 }]);
    expect(screen.getByTestId('24c-undo-toast')).toHaveTextContent(/^Goodnight sent to Sam/);
    await act(async () => fireEvent.press(screen.getByTestId('24c-undo')));
    await settle();
    expect(world.littleThingsUndone).toEqual(['lt-1']);
    expect(screen.queryByTestId('24c-undo-toast')).toBeNull();
  });

  it('24d: Sam\'s 3 kisses play once; the pose is hidden; Reply sends 3 kisses back', async () => {
    await show(find('24d', 'received'), light);
    expect(screen.getByTestId('24d-text')).toHaveTextContent('Sam sent you 3 kisses');
    expect(screen.getByTestId('24d-reply').props.accessibilityLabel).toBe('Kiss back');
    // The pose is decorative: in the tree, hidden from screen readers (the line says it all).
    expect(screen.queryByTestId('24d-pose-kiss', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('24d-pose-kiss', { includeHiddenElements: false })).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('24d-reply')));
    await settle();
    expect(world.littleThingsSent).toEqual([{ kind: 'kiss', amount: 3 }]);
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
  });

  it('24d plays once per phone: Today again (same gestures, no reset) shows no bubble', async () => {
    const c = find('24d', 'received');
    await show(c, light);
    expect(screen.getByTestId('24d-bubble')).toBeTruthy();
    // Same phone, Today left and opened again: the newest gesture is already marked seen.
    await act(async () => screen.unmount());
    jest.useRealTimers();
    await renderRouter(APP_DIR, { initialUrl: c.url });
    await screen.findByTestId('24b-button', {}, { timeout: 8000 });
    await settle();
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
  });

  it('24d back: "Sam hugged you back" when Sam answers my hug within 10 minutes', async () => {
    await show(find('24d', 'back'), light);
    expect(screen.getByTestId('24d-text')).toHaveTextContent('Sam hugged you back');
  });

  it('24d Reply at my free kiss limit opens the paywall and sends nothing', async () => {
    await show(find('24d', 'reply-at-limit'), light);
    expect(screen.getByTestId('16-screen')).toBeTruthy();
    expect(world.littleThingsSent).toEqual([]);
  });

  it('24d: my own gestures never play on my phone', async () => {
    const c = find('24d', 'received');
    await show({ ...c, world: (w) => { c.world!(w); w.littleThingsRecent = w.littleThingsRecent.map((g) => ({ ...g, senderId: ME })); }, expect: '24b-button' }, light);
    expect(screen.queryByTestId('24d-bubble')).toBeNull();
  });
});

describe('40 Share usage data (D54, MOB-24b)', () => {
  const find = (state: string) => CASES.find((x) => x.id === '40' && x.state === state)!;
  const LABEL = 'Share usage data. Anonymous counts of what you tap, never what you write. Helps us improve Bonded.';
  const row = () => screen.getByTestId('40-share-usage');

  it('one switch, spoken with its description, on by default, 44 pt', async () => {
    await show(find('paired-free'), MODES[0]!);
    expect(row().props.accessibilityRole).toBe('switch');
    expect(row().props.accessibilityLabel).toBe(LABEL);
    expect(row().props.accessibilityState).toMatchObject({ checked: true });
    expect(row().props.style).toMatchObject({ minHeight: 44, minWidth: 44 });
    // The visible label and description are hidden from screen readers (the switch says both).
    expect(screen.queryByText('Share usage data', { includeHiddenElements: false })).toBeNull();
  });

  it('tap turns sharing off (switch state, store, stored opt-out); tap again turns it back on', async () => {
    await show(find('paired-free'), MODES[0]!);
    await act(async () => fireEvent.press(row()));
    await settle();
    expect(row().props.accessibilityState).toMatchObject({ checked: false });
    expect(useAnalyticsConsent.getState().sharing).toBe(false);
    expect(isOptedOut()).toBe(true);
    await act(async () => fireEvent.press(row()));
    await settle();
    expect(row().props.accessibilityState).toMatchObject({ checked: true });
    expect(isOptedOut()).toBe(false);
  });

  it('share-usage-off: the switch says off', async () => {
    await show(find('share-usage-off'), MODES[0]!);
    expect(row().props.accessibilityState).toMatchObject({ checked: false });
  });
});
