import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Keyboard,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';

import { useReducedMotion } from './useReducedMotion';

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

export type Rect = { y: number; height: number };

/**
 * #85: the part of the body to keep visible for a focused field. When a `KeepInView` group holds
 * the field (its counter and hint lines under it) and fits in the viewport, the whole group.
 * #108: when it doesn't fit (a two-line pinned button at 200% text), the bottom of the group, as
 * long as that still shows the bottom of the field (where the caret is) with the lines under it;
 * otherwise just the field, so the caret never scrolls away.
 */
export function rectToKeepInView(
  field: Rect,
  groups: readonly Rect[],
  viewportHeight: number,
  margin: number,
): Rect {
  const holder = groups.find((g) => g.y <= field.y && g.y + g.height >= field.y + field.height);
  if (!holder) return field;
  const room = viewportHeight - 2 * margin;
  if (holder.height <= room) return holder;
  const bottom = holder.y + holder.height;
  const fieldBottom = field.y + field.height;
  // Field bottom plus a line of text above it must still show, else the caret wins.
  const caretLine = Math.min(field.height, 2 * margin);
  if (bottom - fieldBottom + caretLine > room) return field;
  return { y: bottom - room, height: room };
}

type Measurable = {
  measureLayout: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ) => void;
};

/** The `KeepInView` groups of one scrolling body (a registry, not render state). */
export type KeepInViewGroups = { readonly views: Set<Measurable> };
type Groups = KeepInViewGroups;

/** One registry per frame: pass it to the hook and to `KeepInViewProvider`. */
export function useKeepInViewGroups(): KeepInViewGroups {
  const [groups] = useState<KeepInViewGroups>(() => ({ views: new Set() }));
  return groups;
}

const NO_GROUPS: KeepInViewGroups = { views: new Set() };

const KeepInViewContext = createContext<Groups | null>(null);

/** The frame provides this around its scrolling body (value: `groups` from the hook). */
export const KeepInViewProvider = KeepInViewContext.Provider;

/**
 * #85: wrap a field together with what belongs under it (counter, "Private until you both
 * answer"); while the field is focused the whole group scrolls into view above a pinned button.
 */
export function KeepInView({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const groups = useContext(KeepInViewContext);
  const ref = useCallback(
    (view: ComponentRef<typeof View> | null) => {
      const mine = view as unknown as Measurable | null;
      if (!groups || !mine) return undefined;
      groups.views.add(mine);
      return () => {
        groups.views.delete(mine);
      };
    },
    [groups],
  );
  return createElement(View, { ref, style, testID, collapsable: false }, children);
}

function measure(view: Measurable, inner: unknown): Promise<Rect | null> {
  return new Promise((resolve) => {
    try {
      view.measureLayout(
        inner,
        (_x, y, _w, height) => resolve({ y, height }),
        () => resolve(null),
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * When the keyboard opens (or moves), scroll the focused text field into view. Attach the returned
 * handlers to the ScrollView. RN's KeyboardAvoidingView shrinks the viewport but never scrolls to
 * the field, so on a small phone it ended up behind the pinned button.
 */
export function useFocusedFieldInView(
  scroll: ScrollRef,
  margin: number,
  groups: KeepInViewGroups = NO_GROUPS,
) {
  const viewport = useRef(0);
  const offset = useRef(0);
  // Reduced motion: the field jumps into view instead of gliding (MOB-25).
  const reduced = useReducedMotion();
  const revealRef = useRef<() => void>(() => undefined);

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
        void (async () => {
          const rect = await measure(field, inner);
          if (!rect) return;
          const held = (await Promise.all([...groups.views].map((g) => measure(g, inner)))).filter(
            (g): g is Rect => !!g,
          );
          const keep = rectToKeepInView(rect, held, viewport.current, margin);
          const target = scrollTargetForField({
            fieldY: keep.y,
            fieldHeight: keep.height,
            viewportHeight: viewport.current,
            scrollY: offset.current,
            margin,
          });
          if (target !== null) scroll.current?.scrollTo({ y: target, animated: !reduced });
        })();
      }, 60);
    };
    revealRef.current = reveal;
    // iOS also posts "will show" when focus moves to the next field with the keyboard already up.
    const subs = (['keyboardWillShow', 'keyboardDidShow', 'keyboardDidChangeFrame'] as const).map(
      (event) => Keyboard.addListener(event, reveal),
    );
    return () => {
      clearTimeout(timer);
      subs.forEach((sub) => sub.remove());
    };
  }, [scroll, margin, groups, reduced]);

  return {
    onLayout: (e: LayoutChangeEvent) => {
      viewport.current = e.nativeEvent.layout.height;
      // The viewport shrinks with the keyboard AFTER keyboardDidShow: check again with its new size.
      if (Keyboard.isVisible()) revealRef.current();
    },
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    scrollEventThrottle: 16,
  };
}
