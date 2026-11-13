import { act, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { REPLAY_MASK_PROPS } from '../replay';
import { PushBannerHost } from '@/features/push/components/PushBanner';
import { usePushRoute } from '@/features/push/store';
import { renderUi } from '@/test/render';
import { ToastHost, useToast } from '@/ui';

/**
 * #455 (D63, MOB-87): the toast and push-banner hosts mask only their own box, and only while a
 * toast or banner shows. A no-capture view that fills the window turned every replay frame black,
 * allowed screens included.
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useSegments: () => [] }));

const BANNER = {
  id: 'n1',
  title: 'Sam answered today’s question',
  body: 'Your turn. Answer to unlock theirs.',
  href: '/question/00000000-0000-4000-c000-000000000001' as const,
};

function expectBoxOnly(style: unknown) {
  const flat = StyleSheet.flatten(style as never) as Record<string, unknown>;
  expect(flat.position).toBe('absolute');
  // Sized by its content: no bottom edge, so never the whole window.
  expect(flat.bottom).toBeUndefined();
  expect(typeof flat.top).toBe('number');
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
  useToast.setState({ toast: null });
  usePushRoute.setState({ banner: null, pending: null });
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_ANALYTICS_REPLAY;
});

describe.each([
  {
    name: 'ToastHost',
    ui: <ToastHost />,
    show: () => useToast.getState().show('Saved for Sam'),
    content: 'toast',
    pointerEvents: 'none',
  },
  {
    name: 'PushBannerHost',
    ui: <PushBannerHost />,
    show: () => usePushRoute.getState().showBanner(BANNER),
    content: '37-banner',
    pointerEvents: 'box-none',
  },
])('$name with replay on', ({ ui, show, content, pointerEvents }) => {
  it('mounts no mask while nothing shows', async () => {
    await renderUi(ui);
    expect(screen.queryByTestId('replay-mask')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('ph-no-capture');
  });

  it('masks only its own box while it shows, and lets touches through around it', async () => {
    await renderUi(ui);
    await act(async () => show());
    const mask = screen.getByTestId('replay-mask');
    expect(mask.props).toMatchObject({ ...REPLAY_MASK_PROPS, pointerEvents });
    expectBoxOnly(mask.props.style);
    // The toast / banner (and its text) sits inside the mask.
    expect(within(mask).getByTestId(content)).toBeTruthy();
  });

  it('without the flag: same box, no mask', async () => {
    delete process.env.EXPO_PUBLIC_ANALYTICS_REPLAY;
    await renderUi(ui);
    await act(async () => show());
    expect(screen.queryByTestId('replay-mask')).toBeNull();
    expect(screen.getByTestId(content)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain('ph-no-capture');
  });
});
