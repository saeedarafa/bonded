import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { toAppError } from '@/lib/errors';
import { haptics, Icon, Text, useReducedMotion, useTheme, useToast } from '@/ui';

import { LittleThingLimitError, type SentLittleThing } from '../api';
import {
  useLittleThingsTip,
  useLittleThingsToday,
  useSendLittleThing,
  useUndoLittleThing,
} from '../hooks';
import {
  fanOffsets,
  fanOrder,
  FAN_RADIUS,
  HUG_MAX_MS,
  KISS_BATCH_MS,
  KISS_MAX,
  LITTLE_THING_KINDS,
  NOTHING_SENT,
  PEEK_EVERY_MS,
  PEEK_SHOW_MS,
  sendAmount,
  timeOfDayKind,
  UNDO_MS,
  type LittleThingKind,
} from '../model';
import { FanItem, ITEM_SIZE, ITEM_WIDTH, KIND_ICON, MAIN_SIZE } from './FanItem';

export const BUTTON_SIZE = 56;
/** The board puts the button 20 pt from the right edge, 20 pt above the tab bar (24b). */
export const BUTTON_INSET = 20;
const TIP_DELAY_MS = 900;
const HUG_TICK_MS = 100;

/** Event handlers only (the hug hold); module-level so the purity lint sees no render-time clock. */
function nowMs(): number {
  return Date.now();
}

/** Module-level so the React compiler lint doesn't treat the shared value as render state. */
function popIn(value: SharedValue<number>, duration: number) {
  value.value = 0.6;
  value.value = withTiming(1, { duration });
}

type Props = {
  partner: string;
  /** Distance from the bottom of the area to the button (above Today's pinned actions). */
  bottom: number;
  /** Fan open or closed: Today hides the content behind it from screen readers while open. */
  onOpenChange?: (open: boolean) => void;
};

type UndoToast = { id: number; text: string; sent: Promise<SentLittleThing | null> };

/**
 * Little things, sending (D48, MOB-58, screens 24b and 24c). A round button bottom-right of Today
 * in the viewer's colour; its icon follows the time of day and peeks at the others. Tap opens a fan
 * of five; Kiss counts taps (up to 5, sent after a 1 s pause), Hug fills a ring while held (up to
 * 5 s), the others send on a tap. A 3 s toast offers Undo. The limits are the server's: an item is
 * grey when `little_things_today()` says so; free couples get "More … with Premium" -> paywall.
 */
export function LittleThings({ partner, bottom, onOpenChange }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, space, motion } = useTheme();
  const reduced = useReducedMotion();
  const window = useWindowDimensions();
  const today = useLittleThingsToday({ enabled: true });
  const send = useSendLittleThing();
  const undo = useUndoLittleThing();
  const tipSeen = useLittleThingsTip((s) => s.seen);
  const markTipSeen = useLittleThingsTip((s) => s.markSeen);

  const [open, setOpenState] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [peek, setPeek] = useState<LittleThingKind | null>(null);
  const [tipReady, setTipReady] = useState(false);
  const [toast, setToast] = useState<UndoToast | null>(null);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const toastSeq = useRef(0);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const main = timeOfDayKind(now);
  const state = today.data ?? NOTHING_SENT;

  // The time of day moves on while Today stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Peek (D48): every few seconds the icon briefly shows another gesture. Never with Reduce Motion.
  useEffect(() => {
    if (reduced || open) return undefined;
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const id = setInterval(() => {
      const others = LITTLE_THING_KINDS.filter((k) => k !== main);
      setPeek(others[i++ % others.length] ?? null);
      timers.push(setTimeout(() => setPeek(null), PEEK_SHOW_MS));
    }, PEEK_EVERY_MS);
    return () => {
      clearInterval(id);
      timers.forEach(clearTimeout);
      setPeek(null);
    };
  }, [reduced, open, main]);

  const pop = useSharedValue(1);
  const shown = (reduced || open ? null : peek) ?? main;
  useEffect(() => {
    if (!reduced) popIn(pop, motion.duration.fast);
  }, [shown, reduced, pop, motion.duration.fast]);
  const iconStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: pop.value }],
  }));

  // 24b: the one-time tip, a moment after Today settles.
  useEffect(() => {
    if (tipSeen) return undefined;
    const id = setTimeout(() => setTipReady(true), TIP_DELAY_MS);
    return () => clearTimeout(id);
  }, [tipSeen]);

  // Leaving Today closes the fan; Android back closes it too.
  useFocusEffect(useCallback(() => () => setOpen(false), [setOpen]));
  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open, setOpen]);

  // The Undo toast hides after 3 s.
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), UNDO_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const sentText = (kind: LittleThingKind, amount: number): string => {
    if (kind === 'hug')
      return t('littleThings.sent.hug', { seconds: Math.round(amount / 1000), partner });
    if (kind === 'kiss') return t('littleThings.sent.kiss', { count: amount, partner });
    return t(`littleThings.sent.${kind}`, { partner });
  };

  const doSend = (kind: LittleThingKind, raw: number) => {
    const amount = sendAmount(kind, raw);
    setOpen(false);
    haptics.light();
    const id = ++toastSeq.current;
    const sent = send
      .mutateAsync({ kind, amount, clientId: randomUUID() })
      .then((result) => {
        if (result.sameTime)
          setToast((cur) => (cur?.id === id ? { ...cur, text: t('littleThings.sameTime') } : cur));
        return result;
      })
      .catch((e: unknown) => {
        setToast((cur) => (cur?.id === id ? null : cur));
        const err = toAppError(e);
        if (err instanceof LittleThingLimitError) {
          // A kiss batch can be refused while the item isn't grey (8 sent, 3 more asked).
          const nowFull = err.limitKind ? state[err.limitKind].atLimit : false;
          useToast
            .getState()
            .show(kind === 'kiss' && !nowFull ? t('littleThings.tooMany') : err.message, 'info');
        } else {
          useToast.getState().show(err.message, 'error');
        }
        return null;
      });
    setToast({ id, text: sentText(kind, amount), sent });
  };

  const onUndo = () => {
    const current = toast;
    if (!current) return;
    setToast(null);
    haptics.light();
    void current.sent.then((result) => {
      if (!result) return;
      undo.mutate(result.id, {
        onSuccess: () => useToast.getState().show(t('littleThings.undone', { partner }), 'info'),
        onError: (e) => useToast.getState().show(e.message, 'error'),
      });
    });
  };

  const openPaywall = () => {
    setOpen(false);
    router.push({ pathname: '/paywall', params: { from: 'little_things' } });
  };

  const toggle = () => {
    if (!tipSeen) markTipSeen();
    haptics.selection();
    if (!open) void today.refetch();
    setOpen(!open);
  };

  // Geometry: the button's centre within this overlay; the fan is a quarter circle around it.
  const width = area?.width ?? window.width;
  const height = area?.height ?? window.height;
  const cx = width - BUTTON_INSET - BUTTON_SIZE / 2;
  const cy = height - bottom - BUTTON_SIZE / 2;
  const fanRadius = Math.max(120, Math.min(FAN_RADIUS, cx - ITEM_WIDTH / 2, cy - MAIN_SIZE));

  return (
    <View
      pointerEvents="box-none"
      // Open, the fan and its close button are the only things a screen reader reaches.
      accessibilityViewIsModal={open}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      onLayout={(e) =>
        setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
    >
      {open ? (
        <Fan
          main={main}
          state={state}
          partner={partner}
          cx={cx}
          cy={cy}
          radius={fanRadius}
          onClose={() => setOpen(false)}
          onSend={doSend}
          onPaywall={openPaywall}
        />
      ) : null}

      {!tipSeen && tipReady && !open ? (
        <Pressable
          testID="24b-tip"
          accessibilityRole="button"
          accessibilityLabel={t('littleThings.tip', { partner })}
          accessibilityHint={t('littleThings.tipDismiss')}
          onPress={markTipSeen}
          style={{
            position: 'absolute',
            right: BUTTON_INSET - 4,
            bottom: bottom + BUTTON_SIZE + space.md - 2,
            maxWidth: Math.min(280, width - space.xl * 2),
            backgroundColor: colors.text,
            borderRadius: radius.tile + 5,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
          }}
        >
          <Text variant="caption" style={{ color: colors.bg }}>
            {t('littleThings.tip', { partner })}
          </Text>
          <View
            style={{
              position: 'absolute',
              right: 30,
              bottom: -5,
              width: 10,
              height: 10,
              backgroundColor: colors.text,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </Pressable>
      ) : null}

      <Pressable
        testID="24b-button"
        accessibilityRole="button"
        accessibilityLabel={open ? t('littleThings.close') : t('littleThings.button', { partner })}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={({ pressed }) => ({
          position: 'absolute',
          right: BUTTON_INSET,
          bottom,
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: BUTTON_SIZE / 2,
          backgroundColor: open ? colors.text : colors.you,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pressed && !reduced ? 0.92 : 1 }],
          shadowColor: colors.youText,
          shadowOpacity: 0.35,
          shadowRadius: 11,
          shadowOffset: { width: 0, height: 10 },
          elevation: 6,
        })}
      >
        {open ? (
          <Icon name="close" size={22} color={colors.surface} />
        ) : (
          <Animated.View testID={`24b-icon-${shown}`} style={iconStyle}>
            <Icon name={KIND_ICON[shown]} size={22} color={colors.onYou} />
          </Animated.View>
        )}
      </Pressable>

      {toast ? (
        <View
          testID="24c-undo-toast"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            top: space.sm,
            left: space.lg,
            right: space.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: colors.text,
            borderRadius: radius.card - 2,
            paddingLeft: space.lg,
            paddingRight: space.sm,
            paddingVertical: space.sm,
          }}
        >
          <Text variant="label" style={{ color: colors.bg, flex: 1 }} accessibilityRole="alert">
            {toast.text}
          </Text>
          <Pressable
            testID="24c-undo"
            accessibilityRole="button"
            accessibilityLabel={t('littleThings.undoA11y')}
            onPress={onUndo}
            hitSlop={8}
            style={{
              minHeight: 36,
              minWidth: 44,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: colors.you,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="button" style={{ color: colors.onYou }}>
              {t('littleThings.undo')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

type FanProps = {
  main: LittleThingKind;
  state: Record<LittleThingKind, { atLimit: boolean; morePremium: boolean }>;
  partner: string;
  cx: number;
  cy: number;
  radius: number;
  onClose: () => void;
  onSend: (kind: LittleThingKind, amount: number) => void;
  onPaywall: () => void;
};

const PREMIUM_COPY: readonly LittleThingKind[] = ['hug', 'kiss', 'miss_you'];

/** 24c: the open fan over a light scrim. Lives only while open, so its counters start fresh. */
function Fan({ main, state, partner, cx, cy, radius, onClose, onSend, onPaywall }: FanProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const order = fanOrder(main);
  const offsets = fanOffsets(radius);

  const [kisses, setKisses] = useState(0);
  const kissRef = useRef(0);
  const kissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hugMs, setHugMs] = useState(0);
  const hugStart = useRef<number | null>(null);
  const hugTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hugSent = useRef(false);
  const [note, setNote] = useState<Partial<Record<LittleThingKind, string>>>({});
  const sentRef = useRef(false);

  useEffect(
    () => () => {
      if (kissTimer.current) clearTimeout(kissTimer.current);
      if (hugTimer.current) clearInterval(hugTimer.current);
    },
    [],
  );

  const finish = (kind: LittleThingKind, amount: number) => {
    if (sentRef.current) return;
    sentRef.current = true;
    if (kissTimer.current) clearTimeout(kissTimer.current);
    if (hugTimer.current) clearInterval(hugTimer.current);
    onSend(kind, amount);
  };

  const isPremiumOffer = (kind: LittleThingKind) =>
    state[kind].morePremium && PREMIUM_COPY.includes(kind);

  const onGrey = (kind: LittleThingKind) => {
    if (isPremiumOffer(kind)) {
      onPaywall();
      return;
    }
    haptics.error();
    setNote((n) => ({ ...n, [kind]: t(`littleThings.atLimit.${kind}`) }));
  };

  const onKiss = () => {
    if (state.kiss.atLimit) return onGrey('kiss');
    if (kissRef.current >= KISS_MAX) {
      haptics.error();
      setNote((n) => ({ ...n, kiss: t('littleThings.kissMax') }));
      return;
    }
    kissRef.current += 1;
    setKisses(kissRef.current);
    haptics.selection();
    if (kissTimer.current) clearTimeout(kissTimer.current);
    kissTimer.current = setTimeout(() => finish('kiss', kissRef.current), KISS_BATCH_MS);
  };

  const hugIn = () => {
    if (state.hug.atLimit || hugStart.current !== null) return;
    hugStart.current = nowMs();
    hugSent.current = false;
    hugTimer.current = setInterval(() => {
      const held = nowMs() - (hugStart.current ?? nowMs());
      setHugMs(Math.min(held, HUG_MAX_MS));
      if (held >= HUG_MAX_MS) {
        hugSent.current = true;
        haptics.success();
        finish('hug', HUG_MAX_MS);
      }
    }, HUG_TICK_MS);
  };
  const hugOut = () => {
    if (hugStart.current === null) return;
    const held = nowMs() - hugStart.current;
    hugStart.current = null;
    if (hugTimer.current) clearInterval(hugTimer.current);
    if (hugSent.current) return;
    hugSent.current = true;
    finish('hug', Math.min(held, HUG_MAX_MS));
  };
  // A press without a hold (screen readers activate without touching down): a short hug.
  const hugPress = () => {
    if (state.hug.atLimit) return onGrey('hug');
    if (hugSent.current) return;
    finish('hug', 0);
  };

  const labelFor = (kind: LittleThingKind): string => {
    if (note[kind]) return note[kind];
    if (state[kind].atLimit)
      return isPremiumOffer(kind)
        ? t(`littleThings.morePremium.${kind as 'hug' | 'kiss' | 'miss_you'}`)
        : t(`littleThings.atLimit.${kind}`);
    if (kind === 'kiss' && kisses > 0) return t('littleThings.kisses', { count: kisses });
    if (kind === 'hug' && hugMs > 0)
      return t('littleThings.hugSeconds', { seconds: (hugMs / 1000).toFixed(1) });
    return t(`littleThings.name.${kind}`);
  };

  const a11yFor = (kind: LittleThingKind): { label: string; hint?: string } => {
    const name = t(`littleThings.a11yName.${kind}`);
    if (state[kind].atLimit) {
      if (isPremiumOffer(kind))
        return {
          label: t('littleThings.atLimitA11y', { name, state: labelFor(kind) }),
          hint: t('littleThings.morePremiumHint'),
        };
      return { label: t('littleThings.atLimitA11y', { name, state: labelFor(kind) }) };
    }
    if (kind === 'kiss')
      return {
        label: kisses > 0 ? t('littleThings.kisses', { count: kisses }) : name,
        hint: t('littleThings.hint.kiss'),
      };
    if (kind === 'hug')
      return {
        label:
          hugMs > 0
            ? t('littleThings.hugSecondsA11y', { seconds: (hugMs / 1000).toFixed(1) })
            : name,
        hint: t('littleThings.hint.hug'),
      };
    return { label: name, hint: t('littleThings.hint.other', { partner }) };
  };

  return (
    <>
      <Pressable
        testID="24c-scrim"
        accessible={false}
        importantForAccessibility="no"
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.bg,
            opacity: 0.93,
          }}
        />
      </Pressable>
      <View
        testID="24c-fan"
        accessibilityRole="menu"
        accessibilityLabel={t('littleThings.menu')}
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {order.map((kind, i) => {
          const off = offsets[i] ?? { x: 0, y: 0 };
          const isMain = kind === main;
          const size = isMain ? MAIN_SIZE : ITEM_SIZE;
          const a11y = a11yFor(kind);
          return (
            <FanItem
              key={kind}
              kind={kind}
              main={isMain}
              grey={state[kind].atLimit}
              label={labelFor(kind)}
              accessibilityLabel={a11y.label}
              accessibilityHint={a11y.hint}
              count={kind === 'kiss' ? kisses : 0}
              progress={kind === 'hug' ? hugMs / HUG_MAX_MS : 0}
              onPress={
                kind === 'kiss'
                  ? onKiss
                  : kind === 'hug'
                    ? hugPress
                    : () => (state[kind].atLimit ? onGrey(kind) : finish(kind, 1))
              }
              onPressIn={kind === 'hug' ? hugIn : undefined}
              onPressOut={kind === 'hug' ? hugOut : undefined}
              style={{ left: cx + off.x - ITEM_WIDTH / 2, top: cy + off.y - size / 2 }}
            />
          );
        })}
      </View>
    </>
  );
}
