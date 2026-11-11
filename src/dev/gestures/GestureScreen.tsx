import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Button,
  GESTURE_KINDS,
  gestureDurationMs,
  Mascot,
  ReducedMotionOverride,
  SchemeOverride,
  Toggle,
  useReducedMotion,
  useTheme,
  type GestureKind,
  type MascotGesture,
} from '@/ui';

/**
 * Dev-only (`/dev/gestures`, MOB-66): plays each little-things moment on Today-sized mascots on
 * demand, for the device check (60 fps with the perf monitor, light/dark, Reduce Motion) without
 * two paired accounts. Not product copy: plain strings, never shown to users. Kept out of the
 * gallery so its QA-07 baselines stay as they are.
 */
const copy = {
  dark: 'Dark mode',
  still: 'Reduce motion',
  bao: 'Bao acts (my send)',
  sam: 'Sam',
};
const NAMES: Record<GestureKind, string> = {
  hug: 'Hug 3 s',
  kiss: 'Kiss x3',
  goodnight: 'Goodnight',
  good_morning: 'Morning',
  miss_you: 'Miss you',
};
const AMOUNT: Record<GestureKind, number> = {
  hug: 3000,
  kiss: 3,
  goodnight: 1,
  good_morning: 1,
  miss_you: 1,
};

export function GestureScreen() {
  const system = useReducedMotion();
  const [dark, setDark] = useState(false);
  const [still, setStill] = useState(system);
  return (
    <SchemeOverride scheme={dark ? 'dark' : 'light'}>
      <ReducedMotionOverride value={still}>
        <GestureBody dark={dark} still={still} onDark={setDark} onStill={setStill} />
      </ReducedMotionOverride>
    </SchemeOverride>
  );
}

function GestureBody(p: {
  dark: boolean;
  still: boolean;
  onDark: (v: boolean) => void;
  onStill: (v: boolean) => void;
}) {
  const { colors, space } = useTheme();
  const [playing, setPlaying] = useState<MascotGesture | null>(null);
  const [actor, setActor] = useState<'you' | 'partner'>('partner');
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const play = (kind: GestureKind) => {
    seq.current += 1;
    const gesture: MascotGesture = { kind, amount: AMOUNT[kind], actor, id: `g${seq.current}` };
    setPlaying(gesture);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setPlaying(null),
      gestureDurationMs(kind, gesture.amount) + 300,
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        <Toggle label={copy.dark} value={p.dark} onValueChange={p.onDark} />
        <Toggle label={copy.still} value={p.still} onValueChange={p.onStill} />
        <Toggle
          label={copy.bao}
          value={actor === 'you'}
          onValueChange={(v) => setActor(v ? 'you' : 'partner')}
        />
        <View style={{ flexDirection: 'row', gap: space.lg, alignItems: 'flex-end' }}>
          <Mascot mood="together" size={170} partnerName={copy.sam} gesture={playing} />
          <Mascot mood="waiting" size={120} partnerName={copy.sam} gesture={playing} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {GESTURE_KINDS.map((kind) => (
            <Button key={kind} label={NAMES[kind]} variant="ghost" onPress={() => play(kind)} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
