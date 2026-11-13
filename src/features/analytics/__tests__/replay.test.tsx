import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  REPLAY_ALLOWED_ROUTES,
  REPLAY_MASK_PROPS,
  REPLAY_NEVER_PREFIXES,
  ReplayBoundary,
  ReplayMask,
  replayMayShow,
  replayNever,
  replayRouteId,
} from '../replay';
import { readSource, sourceFiles } from '@/test/sourceFiles';

/**
 * D63 / SEC-23 A2 (MOB-87): an allow-list of recorded routes; every other route, every sheet, the
 * milestone modal, banners and toasts render under the SDK's no-capture mask; `ph-no-mask` is
 * banned. Without EXPO_PUBLIC_ANALYTICS_REPLAY nothing is wrapped at all.
 */

let mockSegments: string[] = [];
jest.mock('expo-router', () => ({ useSegments: () => mockSegments }));

afterEach(() => {
  delete process.env.EXPO_PUBLIC_ANALYTICS_REPLAY;
});

/** Route ids of every screen file in app/ (groups kept, `index` and `_layout` dropped). */
function appRoutes(): string[] {
  return sourceFiles('app')
    .filter((f) => !/\/_layout\.tsx$/.test(f) && !/\+/.test(f))
    .map((f) =>
      replayRouteId(
        f
          .replace(/^app\//, '')
          .replace(/\.tsx?$/, '')
          .split('/'),
      ),
    )
    .filter((r) => r !== '');
}

describe('route policy', () => {
  it('every allow-listed route exists (no typos that silently mask nothing new)', () => {
    const routes = new Set(appRoutes());
    for (const r of REPLAY_ALLOWED_ROUTES) expect(routes).toContain(r);
  });

  it('the allow-list and the never list are disjoint', () => {
    for (const r of REPLAY_ALLOWED_ROUTES) expect(replayNever(r)).toBe(false);
  });

  it.each([
    // 19-22 and the thread
    '(tabs)/today',
    '(tabs)/today/answer',
    '(tabs)/today/reveal',
    '(tabs)/today/revealed',
    '(tabs)/today/thread',
    'question/[id]',
    'question/[id]/thread',
    // 23-25 history and recap
    '(tabs)/history',
    '(tabs)/history/recap',
    '(tabs)/history/[questionId]/thread',
    'ended',
    'ended/[questionId]',
    // codes and links (06/08/J)
    '(pairing)/invite',
    '(pairing)/join',
    '(pairing)/waiting',
    'j/[code]',
    'join/code',
    'join/name',
    'join/welcome',
    'join/sign-in',
    'auth/callback',
    // 38 Us, key dates, names, feedback, delete
    '(tabs)/us',
    '(tabs)/us/couple',
    '(tabs)/us/badges',
    '(tabs)/us/delete',
    '(tabs)/us/feedback',
    '(pairing)/paired',
    '(pairing)/partner-left',
    'milestone/[n]',
    '(tabs)/packs/[packId]',
    '(onboarding)/quiz/names',
    '(onboarding)/quiz/dates',
    '(onboarding)/plan/first-question',
    '(onboarding)/plan/yours',
    // first names (SEC review of #439)
    '(onboarding)/plan/building',
    '(onboarding)/plan/trial',
    '(onboarding)/plan/moment',
    '(offer)/paywall',
    '(offer)/success',
    '(offer)/gift',
    '(pairing)/reminders',
    '(tabs)/packs',
  ])('%s is never recorded', (route) => {
    expect(replayNever(route)).toBe(true);
    expect(replayMayShow(route)).toBe(false);
  });

  it('a route on neither list is masked (fails closed)', () => {
    expect(replayMayShow('(tabs)/brand-new-screen')).toBe(false);
    expect(replayMayShow('')).toBe(false);
  });

  it('the opened gift may show, the gift note never', () => {
    expect(replayMayShow('(offer)/gift/opened')).toBe(true);
    expect(replayMayShow('(offer)/gift')).toBe(false);
  });

  it('Us settings without names may show, Us itself never', () => {
    expect(replayMayShow('(tabs)/us/notifications')).toBe(true);
    expect(replayMayShow('(tabs)/us')).toBe(false);
  });

  it('every app route is either allowed or masked, and each never-list entry matches a route', () => {
    const routes = appRoutes();
    for (const p of REPLAY_NEVER_PREFIXES) {
      expect(routes.some((r) => r === p || r.startsWith(`${p}/`))).toBe(true);
    }
  });
});

describe('mask props match the SDK', () => {
  it('equal the props PostHogMaskView sets', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostHogMaskView } = require(
      `${process.cwd()}/node_modules/posthog-react-native/dist/PostHogMaskView.js`,
    ) as {
      PostHogMaskView: (p: { children: unknown }) => { props: Record<string, unknown> };
    };
    const el = PostHogMaskView({ children: null });
    expect({
      accessibilityLabel: el.props.accessibilityLabel,
      importantForAccessibility: el.props.importantForAccessibility,
      collapsable: el.props.collapsable,
    }).toEqual(REPLAY_MASK_PROPS);
  });

  it('nobody unmasks: no ph-no-mask anywhere in app/ or src/', () => {
    const files = [...sourceFiles('app'), ...sourceFiles('src')];
    for (const f of files) expect(readSource(f).toLowerCase()).not.toContain('ph-no-mask');
  });

  it('nothing else sets the no-capture label by hand', () => {
    const files = [...sourceFiles('app'), ...sourceFiles('src')].filter((f) =>
      readSource(f).includes('ph-no-capture'),
    );
    expect(files).toEqual(['src/features/analytics/replay.tsx']);
  });
});

describe('ReplayBoundary / ReplayMask', () => {
  it('without the flag: no wrapper at all', async () => {
    mockSegments = ['(tabs)', 'today', 'answer'];
    const screen = await render(
      <>
        <ReplayBoundary>
          <Text>screen</Text>
        </ReplayBoundary>
        <ReplayMask>
          <Text>sheet</Text>
        </ReplayMask>
      </>,
    );
    expect(screen.queryByTestId('replay-boundary')).toBeNull();
    expect(screen.queryByTestId('replay-mask')).toBeNull();
  });

  it('with the flag: a never-recorded route is masked', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    mockSegments = ['(tabs)', 'today', 'answer'];
    const screen = await render(
      <ReplayBoundary>
        <Text>screen</Text>
      </ReplayBoundary>,
    );
    expect(screen.getByTestId('replay-boundary').props.accessibilityLabel).toBe('ph-no-capture');
  });

  it('with the flag: an allowed route keeps one stable, unlabelled wrapper', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    mockSegments = ['(onboarding)', 'welcome'];
    const screen = await render(
      <ReplayBoundary>
        <Text>screen</Text>
      </ReplayBoundary>,
    );
    const boundary = screen.getByTestId('replay-boundary');
    expect(boundary.props.accessibilityLabel).toBeUndefined();
    expect(boundary.props.collapsable).toBe(false);
    mockSegments = ['(tabs)', 'us'];
    await screen.rerender(
      <ReplayBoundary>
        <Text>screen</Text>
      </ReplayBoundary>,
    );
    expect(screen.getByTestId('replay-boundary').props.accessibilityLabel).toBe('ph-no-capture');
  });

  it('with the flag: sheets, the milestone modal, banners and toasts are always masked', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    const screen = await render(
      <ReplayMask overlay>
        <Text>banner</Text>
      </ReplayMask>,
    );
    const mask = screen.getByTestId('replay-mask');
    expect(mask.props).toMatchObject({ ...REPLAY_MASK_PROPS, pointerEvents: 'box-none' });
  });

  it('the root layout, Sheet, milestone modal, banners and toasts use the masks', () => {
    const layout = readSource('app/_layout.tsx');
    expect(layout).toMatch(/<ReplayBoundary>\s*<RootStack \/>/);
    expect(layout).toMatch(/<ReplayMask overlay>\s*<ToastHost \/>/);
    expect(layout).toMatch(/<ReplayMask overlay>\s*<PushBannerHost \/>/);
    expect(readSource('src/ui/components/Sheet.tsx')).toMatch(/<ReplayMask>\s*<SheetBody/);
    expect(readSource('app/milestone/[n].tsx')).toMatch(/<ReplayMask>\s*<MilestoneScreen/);
    // Every native modal route must mask itself (it sits outside the root boundary).
    expect(layout.match(/presentation: '[a-zA-Z]+'/g) ?? []).toEqual(["presentation: 'modal'"]);
  });
});
