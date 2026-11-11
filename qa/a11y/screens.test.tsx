// QA-07: every built screen, in its main states, through the real router (app/), with the fake
// server in world.ts. Per case:
//   light      a11y rules (checks.ts) + reveal rule + locked pack text + no unfaked api calls
//   light-200  the same rules at 200% text, plus no truncation of question/answer/message text
//   dark, and light/dark/200 for `snapshot` cases: a structure + style snapshot (serialise())
// Known product findings go in KNOWN with their GitHub issue; the test fails when one is fixed
// (stale entry), so the list only shrinks.
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { INTRO_ELIGIBILITY_STATUS } from 'react-native-purchases';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSeenBadges } from '@/features/badges/seen';
import { usePendingSetup } from '@/features/onboarding/pendingSetup';
import { useOnboarding } from '@/features/onboarding/store';
import { useOfferShown } from '@/features/premium/offers';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import { useMyInvite } from '@/features/pairing/hooks';
import { usePendingJoin } from '@/features/pairing/joinRequest';
import { setPushStorage } from '@/features/push/registration';
import { setSoftAskStorage } from '@/features/push/softAsk';
import { setReviewStorage } from '@/features/review/review';
import { useEndedSeen } from '@/features/settings/partnerLeft';
import { clearDrafts } from '@/lib/drafts';
import { cacheStorage } from '@/lib/storage';
import { memoryStorage } from '@/test/memoryStorage';
import { fakeOfferings, purchasesMock } from '@/test/purchases';

import { asNodes, serialise, type Node } from '../visual/tree';
import {
  a11yFindings,
  lockedPackFindings,
  revealFindings,
  spokenStrings,
  truncationFindings,
} from './checks';
import { MODES, setMode, type Mode } from './mode';
import { CASES, type Case } from './screens';
import { MY_ANSWER, PARTNER_ANSWER, resetWorld, world } from './world';

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
  useEndedSeen.setState({ seen: [] });
  clearDrafts();
  setSoftAskStorage(memoryStorage());
  setPushStorage(memoryStorage());
  setReviewStorage(memoryStorage());
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
  if (!world.store) {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    return;
  }
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.getOfferings.mockResolvedValue(fakeOfferings());
  purchasesMock.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue(
    world.store.trialEligible
      ? { product$rc_annual: { status: INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE } }
      : {},
  );
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

afterAll(() => {
  // A KNOWN entry nobody matched is a fixed bug (or a renamed case): remove it.
  const stale = Object.keys(KNOWN).filter((k) => ranRules.has(k.split(' ')[0]!) && !seenKnown.has(k));
  if (stale.length)
    throw new Error(`stale KNOWN entries (fixed?): ${stale.join(' | ')}`);
});
