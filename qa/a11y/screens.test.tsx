// QA-07: every built screen, in its main states, through the real router (app/), with the fake
// server in world.ts. Per case:
//   light      a11y rules (checks.ts) + reveal rule + locked pack text + no unfaked api calls
//   light-200  the same rules at 200% text, plus no truncation of question/answer/message text
//   dark, and light/dark/200 for `snapshot` cases: a structure + style snapshot (serialise())
// Known product findings go in KNOWN with their GitHub issue; the test fails when one is fixed
// (stale entry), so the list only shrinks.
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSeenBadges } from '@/features/badges/seen';
import { useOnboarding } from '@/features/onboarding/store';
import { useMyInvite } from '@/features/pairing/hooks';
import { usePendingJoin } from '@/features/pairing/joinRequest';
import { setPushStorage } from '@/features/push/registration';
import { setSoftAskStorage } from '@/features/push/softAsk';
import { setReviewStorage } from '@/features/review/review';
import { useEndedSeen } from '@/features/settings/partnerLeft';
import { clearDrafts } from '@/lib/drafts';
import { cacheStorage } from '@/lib/storage';
import { memoryStorage } from '@/test/memoryStorage';

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
  // Chip tone `status` (55 offline chip) uses premiumTint/premiumText: Rule 2 vs board S12.
  '54/gallery premium-label: <View> "Waiting to send"': '#133',
};

const key = (c: Case) => `${c.id}/${c.state}`;

function resetClient() {
  // The persisted query cache (MMKV) outlives a render: a previous case's throttled write can land
  // while a later case advances the clock, and the next mount would restore that case's couple as
  // fresh data. Every case starts from an empty cache, as on a clean install.
  cacheStorage.removeItem('query-cache');
  useOnboarding.getState().reset();
  usePendingInvite.getState().clear();
  useMyInvite.getState().set(null);
  usePendingJoin.getState().clear();
  useSeenBadges.setState({ seen: [] });
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

async function show(c: Case, m: Mode): Promise<Node[]> {
  setMode(m);
  resetWorld();
  c.world?.(world);
  resetClient();
  c.client?.();
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
        ...(c.absent ?? [])
          .filter((id) => screen.queryByTestId(id))
          .map((id) => `must not render: ${id}`),
        ...(m.fontScale > 1
          ? truncationFindings(tree, [MY_ANSWER, PARTNER_ANSWER, 'FIXTURE-MSG', 'question'])
          : []),
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

  it('33 for a premium couple shows the premium question text that the free case must hide', async () => {
    const c = CASES.find((x) => x.id === '33' && x.state === 'premium')!;
    const tree = await show(c, MODES[0]!);
    expect(lockedPackFindings(tree).length).toBeGreaterThan(0);
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
