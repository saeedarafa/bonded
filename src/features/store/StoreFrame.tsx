import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTranslation } from '@/i18n';
import { Mascot } from '@/ui';

import { STORE_DEMO } from './demo';
import { C, StoreScreen, T, boardFont } from './StoreScreen';
import {
  STORE_BEZEL,
  STORE_FRAME,
  STORE_SHOT_IDS,
  type StorePlatform,
  type StoreShotId,
} from './storeMode';

/** Scales a `width x height` box by `scale` and takes the scaled size in layout. */
export function Scaled({
  width,
  height,
  scale,
  children,
  style,
}: {
  width: number;
  height: number;
  scale: number;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ width: width * scale, height: height * scale, overflow: 'hidden' }, style]}>
      <View
        style={{
          position: 'absolute',
          width,
          height,
          left: (width * scale - width) / 2,
          top: (height * scale - height) / 2,
          transform: [{ scale }],
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Badge glyphs from the S13 board (24-unit stroke icons). */
function BadgeGlyph({ shot, size }: { shot: StoreShotId; size: number }) {
  const stroke = {
    stroke: C.youText,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  const glyphs: Record<StoreShotId, ReactNode> = {
    today: <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" {...stroke} />,
    reveal: (
      <>
        <Rect x={5} y={11} width={14} height={10} rx={2} {...stroke} />
        <Path d="M8 11V7a4 4 0 0 1 8 0v4" {...stroke} />
      </>
    ),
    thread: (
      <Path
        d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"
        {...stroke}
      />
    ),
    feeling: (
      <Path
        d="M12 2c1.5 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-6 .5 1.5 1.3 2.3 2.5 2.8C11.5 6.5 11.5 4 12 2z"
        {...stroke}
      />
    ),
    widgets: (
      <>
        <Rect x={3} y={3} width={7} height={7} rx={2} {...stroke} />
        <Rect x={14} y={3} width={7} height={7} rx={2} {...stroke} />
        <Rect x={3} y={14} width={18} height={7} rx={2} {...stroke} />
      </>
    ),
    milestone: <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...stroke} />,
    packs: (
      <>
        <Path d="M12 2 2 7l10 5 10-5-10-5z" {...stroke} />
        <Path d="m2 17 10 5 10-5" {...stroke} />
        <Path d="m2 12 10 5 10-5" {...stroke} />
      </>
    ),
    paywall: (
      <>
        <Circle cx={9} cy={8} r={4} {...stroke} />
        <Path d="M2 21v-1a6 6 0 0 1 12 0v1" {...stroke} />
        <Circle cx={17} cy={9} r={3} {...stroke} />
        <Path d="M22 20v-.5a4.5 4.5 0 0 0-6-4.2" {...stroke} />
      </>
    ),
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {glyphs[shot]}
    </Svg>
  );
}

/** Floating card over the frame (`.pop`). Still: screenshots have no motion. */
function Pop({ style, children }: { style: ViewStyle; children: ReactNode }) {
  return <View style={[styles.pop, style]}>{children}</View>;
}

function Pops({ shot, platform }: { shot: StoreShotId; platform: StorePlatform }) {
  const { t } = useTranslation();
  const ios = platform === 'ios';
  const { partner, streak, badge, nextBadge } = STORE_DEMO;
  if (!ios && shot !== 'feeling') return null; // the Android row has pops only on "the feeling"
  switch (shot) {
    case 'reveal':
      return (
        <Pop style={{ left: 12, top: 560 }}>
          <T f={boardFont('display', 700, 17)} color={C.partnerText}>
            {t('store.pops.partnerAnswer', { partner })}
          </T>
        </Pop>
      );
    case 'thread':
      return (
        <Pop style={{ right: 10, top: 470 }}>
          <T f={boardFont('display', 700, 17)} color={C.youText}>
            {t('store.pops.loved')}
          </T>
        </Pop>
      );
    case 'feeling':
      return (
        <>
          <Pop
            style={{
              left: ios ? 26 : 24,
              top: ios ? 640 : 560,
              transform: [{ rotate: '-5deg' }],
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 0,
            }}
          >
            <T f={boardFont('display', 800, ios ? 34 : 26)} color={C.youText}>
              {t('store.pops.streakDays', { count: streak })}
            </T>
            {ios ? (
              <T f={boardFont('body', 500, 14)} color={C.text2}>
                {t('store.pops.streakLine')}
              </T>
            ) : null}
          </Pop>
          <Pop
            style={{ right: ios ? 26 : 24, top: ios ? 760 : 640, transform: [{ rotate: '4deg' }] }}
          >
            <View
              style={[
                styles.badgeDot,
                { width: ios ? 44 : 36, height: ios ? 44 : 36, borderRadius: ios ? 22 : 18 },
              ]}
            >
              <T f={boardFont('display', 800, ios ? 18 : 15)} color={C.onYou}>
                {badge}
              </T>
            </View>
            <View>
              <T f={boardFont('display', 700, 17)}>{t('store.pops.badgeUnlocked')}</T>
              {ios ? (
                <T f={boardFont('body', 500, 13)} color={C.text2}>
                  {t('store.pops.badgeNext', { count: nextBadge })}
                </T>
              ) : null}
            </View>
          </Pop>
        </>
      );
    case 'milestone':
      // `.cf` confetti, frozen mid-fall.
      return (
        <>
          {[
            { left: 40, top: 330, backgroundColor: C.surface, rotate: '24deg' },
            { left: 380, top: 290, backgroundColor: C.youTint, rotate: '-30deg' },
            { left: 120, top: 270, backgroundColor: C.blushTint, rotate: '60deg' },
          ].map(({ rotate, ...pos }) => (
            <View key={pos.left} style={[styles.confetti, pos, { transform: [{ rotate }] }]} />
          ))}
        </>
      );
    default:
      return null;
  }
}

/** The drawn phone (`.dev` + `.scr`): bezel, island or camera hole, the scaled screen inside. */
function Phone({ shot, platform }: { shot: StoreShotId; platform: StorePlatform }) {
  const f = STORE_FRAME[platform];
  const ios = platform === 'ios';
  if (shot === 'feeling') return null;
  const inner = f.screenBox.width / f.screen.width;
  return (
    <View
      style={[
        styles.device,
        {
          top: f.deviceTop,
          left: (f.width - f.deviceWidth) / 2,
          width: f.deviceWidth,
          borderRadius: f.deviceRadius,
        },
      ]}
    >
      <View
        style={{
          width: f.screenBox.width,
          height: f.screenBox.height,
          borderRadius: f.screenBox.radius,
          overflow: 'hidden',
        }}
      >
        <Scaled width={f.screen.width} height={f.screen.height} scale={inner}>
          <StoreScreen shot={shot} platform={platform} />
        </Scaled>
        <View style={ios ? styles.island : styles.hole} />
      </View>
    </View>
  );
}

/**
 * One store screenshot (60 iPhone, 61 Android) at board size: 440 x 956 (iOS) or 432 x 768
 * (Android) px. Orange frame, badge, caption, the phone with the StoreScreen inside, and the
 * floating cards. Scale it to the export size with `Scaled` (the route fits it to the device).
 */
export function StoreFrame({ shot, platform }: { shot: StoreShotId; platform: StorePlatform }) {
  const { t } = useTranslation();
  const f = STORE_FRAME[platform];
  const n = STORE_SHOT_IDS.indexOf(shot) + 1;
  const caption = t(`store.captions.${shot}`);
  const feeling = shot === 'feeling';
  return (
    <View
      testID={`store-frame-${platform}-${shot}`}
      accessible
      accessibilityLabel={t('store.frameLabel', { n, caption })}
      style={[
        styles.frame,
        {
          width: f.width,
          height: f.height,
          paddingTop: f.paddingTop,
          backgroundColor: feeling ? C.youTint : C.you,
        },
      ]}
    >
      <View
        style={[styles.badge, { width: f.badge, height: f.badge, borderRadius: f.badgeRadius }]}
      >
        <BadgeGlyph shot={shot} size={f.badgeIcon} />
      </View>
      <T
        f={{ ...boardFont('display', 800, f.caption), lineHeight: Math.round(f.caption * 1.08) }}
        style={{ ...styles.caption, marginTop: f.captionTop, letterSpacing: f.caption * -0.015 }}
        testID="store-caption"
      >
        {caption}
      </T>
      {feeling ? (
        <View style={{ marginTop: platform === 'ios' ? 60 : 30 }}>
          <Mascot
            mood="celebrating"
            size={platform === 'ios' ? 330 : 280}
            still
            partnerName={STORE_DEMO.partner}
          />
        </View>
      ) : null}
      <Phone shot={shot} platform={platform} />
      <Pops shot={shot} platform={platform} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'relative', overflow: 'hidden', alignItems: 'center' },
  badge: { backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  caption: { textAlign: 'center', paddingHorizontal: 30 },
  device: { position: 'absolute', backgroundColor: C.text, padding: STORE_BEZEL },
  island: {
    position: 'absolute',
    top: 11,
    left: '50%',
    marginLeft: -58,
    width: 116,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.text,
  },
  hole: {
    position: 'absolute',
    top: 12,
    left: '50%',
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.text,
  },
  pop: {
    position: 'absolute',
    zIndex: 3,
    backgroundColor: C.surface,
    borderRadius: 20,
    shadowColor: C.text,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  badgeDot: { backgroundColor: C.you, alignItems: 'center', justifyContent: 'center' },
  confetti: { position: 'absolute', zIndex: 3, width: 10, height: 16, borderRadius: 3 },
});
