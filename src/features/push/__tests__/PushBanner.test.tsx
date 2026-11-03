import { act, fireEvent, screen } from '@testing-library/react-native';

import { PUSH_BANNER_MS, PushBannerHost } from '@/features/push/components/PushBanner';
import { usePushRoute } from '@/features/push/store';
import { renderUi } from '@/test/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const ITEM = {
  id: 'n1',
  title: 'Sam answered today’s question',
  body: 'Your turn. Answer to unlock theirs.',
  href: '/question/00000000-0000-4000-c000-000000000001' as const,
};

describe('PushBannerHost (37 in the app)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockClear();
    usePushRoute.setState({ banner: null, pending: null });
  });
  afterEach(() => jest.useRealTimers());

  it.each(['light', 'dark'] as const)('shows title and body as one button (%s)', async (scheme) => {
    await renderUi(<PushBannerHost />, { scheme });
    expect(screen.queryByTestId('37-banner')).toBeNull();
    await act(async () => usePushRoute.getState().showBanner(ITEM));
    const banner = screen.getByTestId('37-banner');
    expect(banner.props.accessibilityLabel).toBe(`${ITEM.title}. ${ITEM.body}`);
    expect(banner.props.accessibilityRole).toBe('button');
    expect(screen.getByText('now')).toBeTruthy();
  });

  it('hides itself after a few seconds', async () => {
    await renderUi(<PushBannerHost />);
    await act(async () => usePushRoute.getState().showBanner(ITEM));
    await act(async () => jest.advanceTimersByTime(PUSH_BANNER_MS - 1));
    expect(screen.getByTestId('37-banner')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(1));
    expect(screen.queryByTestId('37-banner')).toBeNull();
  });

  it('a tap opens the push target and closes the banner', async () => {
    await renderUi(<PushBannerHost />);
    await act(async () => usePushRoute.getState().showBanner(ITEM));
    await fireEvent.press(screen.getByTestId('37-banner'));
    expect(mockPush).toHaveBeenCalledWith(ITEM.href);
    expect(usePushRoute.getState().banner).toBeNull();
  });

  it('wraps at 200% text and keeps the whole body', async () => {
    await renderUi(<PushBannerHost />, { fontScale: 2 });
    await act(async () => usePushRoute.getState().showBanner(ITEM));
    const body = screen.getByText(ITEM.body);
    expect(body.props.numberOfLines).toBeUndefined();
  });
});
