import { useEffect, useRef, type ComponentRef, type RefObject } from 'react';
import {
  Keyboard,
  TextInput,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

type ScrollRef = RefObject<ComponentRef<typeof ScrollView> | null>;

/**
 * #65: where to scroll so the field being edited is visible in the scroll viewport (the part of
 * the body above a pinned footer and the keyboard). Null when it already is. A field taller than
 * the viewport shows its bottom, where the caret usually is.
 */
export function scrollTargetForField(f: {
  fieldY: number;
  fieldHeight: number;
  viewportHeight: number;
  scrollY: number;
  margin: number;
}): number | null {
  const bottom = f.fieldY + f.fieldHeight + f.margin;
  if (bottom > f.scrollY + f.viewportHeight) return Math.max(0, bottom - f.viewportHeight);
  const top = f.fieldY - f.margin;
  if (top < f.scrollY) return Math.max(0, top);
  return null;
}

type Measurable = {
  measureLayout: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ) => void;
};

/**
 * When the keyboard opens (or moves), scroll the focused text field into view. Attach the returned
 * handlers to the ScrollView. RN's KeyboardAvoidingView shrinks the viewport but never scrolls to
 * the field, so on a small phone it ended up behind the pinned button.
 */
export function useFocusedFieldInView(scroll: ScrollRef, margin: number) {
  const viewport = useRef(0);
  const offset = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      clearTimeout(timer);
      // After the layout settles (the viewport shrinks with the keyboard).
      timer = setTimeout(() => {
        const field = TextInput.State.currentlyFocusedInput() as unknown as Measurable | null;
        const view = scroll.current as unknown as { getInnerViewRef?: () => unknown } | null;
        const inner = view?.getInnerViewRef?.();
        if (!field?.measureLayout || !inner) return;
        field.measureLayout(
          inner,
          (_x, y, _w, h) => {
            const target = scrollTargetForField({
              fieldY: y,
              fieldHeight: h,
              viewportHeight: viewport.current,
              scrollY: offset.current,
              margin,
            });
            if (target !== null) scroll.current?.scrollTo({ y: target, animated: true });
          },
          () => undefined,
        );
      }, 60);
    };
    const shown = Keyboard.addListener('keyboardDidShow', reveal);
    const moved = Keyboard.addListener('keyboardDidChangeFrame', reveal);
    return () => {
      clearTimeout(timer);
      shown.remove();
      moved.remove();
    };
  }, [scroll, margin]);

  return {
    onLayout: (e: LayoutChangeEvent) => {
      viewport.current = e.nativeEvent.layout.height;
    },
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    scrollEventThrottle: 16,
  };
}
