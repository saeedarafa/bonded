import { act, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { renderUi } from '@/test/render';
import { galleryEntries } from '@/dev/gallery/entries';
import { GalleryScreen } from '@/dev/gallery/GalleryScreen';
import * as components from '@/ui/components';

const COMPONENT_EXPORTS = Object.keys(components).filter((name) => /^[A-Z][a-z]/.test(name));

describe('gallery', () => {
  it('shows every component exported by the library', () => {
    const covered = new Set(galleryEntries.flatMap((entry) => entry.covers));
    expect(COMPONENT_EXPORTS.filter((name) => !covered.has(name))).toEqual([]);
    expect([...covered].filter((name) => !COMPONENT_EXPORTS.includes(name))).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('renders every entry in %s', async (scheme) => {
    await renderUi(<GalleryScreen />, { scheme });
    for (const { name } of galleryEntries) {
      expect(screen.getByTestId(`gallery-${name}`)).toBeTruthy();
    }
  });

  it('switches to dark and to 200% text from its own controls', async () => {
    await renderUi(<GalleryScreen />);
    const bg = () => StyleSheet.flatten(screen.getByTestId('gallery').props.style).backgroundColor;
    const light = bg();
    await fireEvent.press(screen.getByRole('switch', { name: 'Dark mode' }));
    expect(bg()).not.toBe(light);

    const heading = () =>
      StyleSheet.flatten(screen.getByRole('header', { name: 'Gallery' }).props.style).fontSize;
    const normal = heading();
    await fireEvent.press(screen.getByRole('switch', { name: 'Text 200%' }));
    expect(heading()).toBe((normal as number) * 2);
  });

  it('never truncates text, at 200% either', async () => {
    await renderUi(<GalleryScreen />, { fontScale: 2 });
    const texts = screen.queryAllByText(/./);
    expect(texts.length).toBeGreaterThan(50);
    const truncated = texts.filter((node) => node.props.numberOfLines !== undefined);
    expect(truncated).toEqual([]);
  });

  it('every pressable control is at least 44 pt tall (and 44 wide when sized)', async () => {
    await renderUi(<GalleryScreen />);
    const roles = ['button', 'switch', 'radio', 'checkbox', 'tab'] as const;
    const tooSmall: string[] = [];
    for (const role of roles) {
      for (const node of screen.queryAllByRole(role)) {
        const style = StyleSheet.flatten(node.props.style) ?? {};
        const height = style.minHeight ?? style.height;
        if (typeof height === 'number' ? height < 44 : true) {
          tooSmall.push(`${role}: ${String(node.props.accessibilityLabel)}`);
        }
        const width = style.minWidth ?? style.width;
        if (typeof width === 'number' && width < 44) {
          tooSmall.push(`${role} (width): ${String(node.props.accessibilityLabel)}`);
        }
      }
    }
    expect(tooSmall).toEqual([]);
  });

  it('shows the toast from the store for 3 seconds', async () => {
    jest.useFakeTimers();
    try {
      await renderUi(<GalleryScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Show toast' }));
      expect(screen.getByTestId('toast')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(3100);
      });
      expect(screen.queryByTestId('toast')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
