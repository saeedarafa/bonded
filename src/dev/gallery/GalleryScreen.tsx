import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  FontScaleOverride,
  ReducedMotionOverride,
  SchemeOverride,
  Text,
  ToastHost,
  Toggle,
  useReducedMotion,
  useTheme,
} from '@/ui';

import { copy } from './copy';
import { galleryEntries } from './entries';

/**
 * Dev-only component gallery (screen 54, `/dev/gallery`). Every component from DESIGN.md §7 in
 * its states, with switches for dark mode, 200% text and reduced motion, so a reviewer (and the
 * QA-07 screenshots) can check light/dark/large-text without touching device settings.
 */
export function GalleryScreen() {
  const system = useReducedMotion();
  const [dark, setDark] = useState(false);
  const [big, setBig] = useState(false);
  const [still, setStill] = useState(system);

  return (
    <SchemeOverride scheme={dark ? 'dark' : 'light'}>
      <ReducedMotionOverride value={still}>
        <FontScaleOverride scale={big ? 2 : 1}>
          <GalleryBody
            dark={dark}
            big={big}
            still={still}
            onDark={setDark}
            onBig={setBig}
            onStill={setStill}
          />
        </FontScaleOverride>
      </ReducedMotionOverride>
    </SchemeOverride>
  );
}

type BodyProps = {
  dark: boolean;
  big: boolean;
  still: boolean;
  onDark: (v: boolean) => void;
  onBig: (v: boolean) => void;
  onStill: (v: boolean) => void;
};

function GalleryBody({ dark, big, still, onDark, onBig, onStill }: BodyProps) {
  const { colors, space, radius } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="gallery">
      <ScrollView
        contentContainerStyle={{ padding: space.gutter, gap: space.xl, paddingBottom: space.hero }}
      >
        <Text variant="h1" accessibilityRole="header">
          {copy.appName}
        </Text>
        <View style={{ gap: space.xs }}>
          <Switch label={copy.darkMode} value={dark} onChange={onDark} />
          <Switch label={copy.large} value={big} onChange={onBig} />
          <Switch label={copy.reducedMotion} value={still} onChange={onStill} />
        </View>
        {galleryEntries.map(({ name, Demo }) => (
          <View
            key={name}
            testID={`gallery-${name}`}
            style={{
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface2,
            }}
          >
            <Text variant="label" tone="text2" accessibilityRole="header">
              {name}
            </Text>
            <Demo />
          </View>
        ))}
      </ScrollView>
      <ToastHost />
    </SafeAreaView>
  );
}

function Switch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="label" style={{ flex: 1 }}>
        {label}
      </Text>
      <Toggle label={label} value={value} onValueChange={onChange} />
    </View>
  );
}
