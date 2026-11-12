import type { ReactNode } from 'react';
import { StyleSheet, View, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useTranslation } from '@/i18n';
import { Icon, Mascot, Text, colors, fonts } from '@/ui';

import { STORE_DEMO, initial } from './demo';
import { STORE_FRAME, type StorePlatform, type StoreShotId } from './storeMode';

/**
 * The phone screen inside a store frame (MOB-26, StoreScreen board): a still, pixel-for-pixel
 * picture of the app at the real layout size (440 x 956 pt on iOS, 412 x 915 dp on Android), with
 * demo data. It is artwork, not a live screen: no data hooks, no touchables, no font scaling, and
 * always the light theme (the store boards are light).
 *
 * Sizes are board px (the frame is scaled to the export size as one picture), so they live in this
 * file instead of type tokens; colours are tokens (nearest token where the board uses a
 * mock-up-only shade, e.g. the home-screen wallpaper).
 */
export const C = colors.light;

type Face = 'display' | 'body';
type Weight = 400 | 500 | 600 | 700 | 800;

/** Board font (`font: <weight> <size>px/<lineHeight> <family>`) as a style. */
export function boardFont(face: Face, weight: Weight, px: number, lineHeight?: number): TextStyle {
  const family =
    face === 'display'
      ? fonts.display[Math.max(600, weight) as 600 | 700 | 800]
      : fonts.body[Math.min(700, weight) as 400 | 500 | 600 | 700];
  return {
    fontFamily: family,
    fontSize: px,
    ...(lineHeight !== undefined ? { lineHeight: Math.round(px * lineHeight) } : {}),
  };
}

/** Text at a fixed size: store art never follows the system font size. */
export function T({
  f,
  color = C.text,
  style,
  children,
  testID,
}: {
  f: TextStyle;
  color?: string;
  style?: TextStyle;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Text allowFontScaling={false} style={[f, { color }, style]} testID={testID}>
      {children}
    </Text>
  );
}

function Dot({
  size,
  name,
  me,
  px,
  style,
}: {
  size: number;
  name: string;
  me: boolean;
  px: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        styles.center,
        { width: size, height: size, borderRadius: size / 2 },
        { backgroundColor: me ? C.you : C.partner },
        style,
      ]}
    >
      <T f={boardFont('display', 700, px)} color={me ? C.onYou : C.onPartner}>
        {initial(name)}
      </T>
    </View>
  );
}

function RoundButton({ icon }: { icon: 'back' | 'close' }) {
  return (
    <View style={[styles.center, styles.roundButton]}>
      <Icon name={icon} color={C.text} size={22} />
    </View>
  );
}

function StatusBar({ platform }: { platform: StorePlatform }) {
  const { t } = useTranslation();
  const ios = platform === 'ios';
  return (
    <View
      style={[styles.statusBar, { height: ios ? 54 : 40, paddingHorizontal: ios ? 34 : 20 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <T f={{ ...boardFont('body', 600, ios ? 17 : 14), fontVariant: ['tabular-nums'] }}>
        {t('store.clock')}
      </T>
      <View style={styles.row6}>
        <Svg width={18} height={12} viewBox="0 0 18 12">
          <Rect x={0} y={8} width={3} height={4} rx={1} fill={C.text} />
          <Rect x={5} y={5.5} width={3} height={6.5} rx={1} fill={C.text} />
          <Rect x={10} y={3} width={3} height={9} rx={1} fill={C.text} />
          <Rect x={15} y={0} width={3} height={12} rx={1} fill={C.text} />
        </Svg>
        <Svg width={27} height={13} viewBox="0 0 27 13">
          <Rect
            x={0.5}
            y={0.5}
            width={23}
            height={12}
            rx={3.5}
            fill="none"
            stroke={C.text}
            opacity={0.4}
          />
          <Rect x={2} y={2} width={20} height={9} rx={2} fill={C.text} />
          <Rect x={24.5} y={4} width={2} height={5} rx={1} fill={C.text} opacity={0.4} />
        </Svg>
      </View>
    </View>
  );
}

function TodayScreen() {
  const { t } = useTranslation();
  const { me, partner, day } = STORE_DEMO;
  const tabs = [
    ['today', 'today'],
    ['history', 'history'],
    ['packs', 'packs'],
    ['us', 'us'],
  ] as const;
  return (
    <>
      <View style={[styles.rowBetween, { paddingVertical: 8, paddingHorizontal: 22 }]}>
        <View style={[styles.row, { gap: 12 }]}>
          <View style={styles.row}>
            <Dot size={42} name={me} me px={17} />
            <Dot size={42} name={partner} me={false} px={17} style={styles.overlap9} />
          </View>
          <View>
            <T f={boardFont('display', 600, 18)}>{t('store.today.couple', { me, partner })}</T>
            <T f={boardFont('body', 500, 14)} color={C.text3}>
              {t('store.today.dayTogether', { day })}
            </T>
          </View>
        </View>
        <View style={[styles.row, styles.streakChip]}>
          <Mascot mood="together" size={28} still partnerName={partner} />
          <T f={boardFont('display', 700, 18)} color={C.youText}>
            {STORE_DEMO.streakChip}
          </T>
        </View>
      </View>
      <View style={[styles.centerColumn, { gap: 8, paddingTop: 10, paddingHorizontal: 30 }]}>
        <Mascot mood="waiting" awake="partner" size={168} still partnerName={partner} />
        <T f={boardFont('body', 400, 17, 1.5)} color={C.text2} style={styles.centerText}>
          {t('store.today.hero', { partner })}
        </T>
      </View>
      <View style={[styles.card, { margin: 20, marginTop: 18, borderRadius: 26, gap: 14 }]}>
        <View style={styles.rowBetween}>
          <View style={[styles.pill, { height: 32, backgroundColor: C.surface2 }]}>
            <T f={boardFont('body', 600, 14)}>{t('store.today.dayChip', { day })}</T>
          </View>
          <T f={{ ...boardFont('body', 500, 14), fontVariant: ['tabular-nums'] }} color={C.text3}>
            {t('store.today.newIn', { time: STORE_DEMO.newIn })}
          </T>
        </View>
        <T f={boardFont('display', 600, 25, 1.28)} testID="store-question">
          {t('store.today.question')}
        </T>
        <View style={[styles.row, styles.divider, { gap: 12 }]}>
          <Dot size={40} name={partner} me={false} px={16} />
          <View style={styles.flex}>
            <T f={boardFont('body', 600, 16)}>{partner}</T>
            <T f={boardFont('body', 500, 14)} color={C.text3}>
              {t('store.today.partnerStatus')}
            </T>
          </View>
        </View>
        <View style={[styles.row, { gap: 12 }]}>
          <Dot size={40} name={me} me px={16} />
          <View style={styles.flex}>
            <T f={boardFont('body', 600, 16)}>{t('store.today.you')}</T>
            <T f={boardFont('body', 500, 14)} color={C.text3}>
              {t('store.today.youStatus')}
            </T>
          </View>
        </View>
      </View>
      <View style={[styles.cta, { marginHorizontal: 20, backgroundColor: C.you }]}>
        <T f={boardFont('display', 700, 19)} color={C.onYou}>
          {t('store.today.cta')}
        </T>
      </View>
      <View style={styles.flex} />
      <View style={styles.tabBar}>
        {tabs.map(([key, icon], i) => (
          <View key={key} style={[styles.centerColumn, { gap: 4 }]}>
            <Icon name={icon} color={i === 0 ? C.youText : C.text3} size={24} />
            <T f={boardFont('body', 600, 12)} color={i === 0 ? C.youText : C.text3}>
              {t(`store.tabs.${key}`)}
            </T>
          </View>
        ))}
      </View>
    </>
  );
}

function HoldRing() {
  const { t } = useTranslation();
  return (
    <Svg width={170} height={170} viewBox="0 0 140 140">
      <Circle cx={70} cy={70} r={62} fill={C.surface} stroke={C.line} strokeWidth={8} />
      <Circle
        cx={70}
        cy={70}
        r={62}
        fill="none"
        stroke={C.you}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray="402 402"
        strokeDashoffset={120}
        transform="rotate(-90 70 70)"
      />
      <Rect
        x={58}
        y={62}
        width={24}
        height={18}
        rx={3}
        fill="none"
        stroke={C.youText}
        strokeWidth={3}
      />
      <Path
        d="M62 62v-6a8 8 0 0 1 16 0"
        fill="none"
        stroke={C.youText}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <SvgText
        x={70}
        y={102}
        textAnchor="middle"
        fontFamily={fonts.display[700]}
        fontSize={17}
        fill={C.text}
      >
        {t('store.reveal.hold')}
      </SvgText>
    </Svg>
  );
}

function RevealScreen() {
  const { t } = useTranslation();
  const { partner } = STORE_DEMO;
  return (
    <>
      <View style={{ paddingVertical: 8, paddingHorizontal: 20 }}>
        <RoundButton icon="back" />
      </View>
      <View style={[styles.centerColumn, { gap: 12, paddingTop: 4, paddingHorizontal: 28 }]}>
        <Mascot mood="celebrating" size={140} still partnerName={partner} />
        <T f={boardFont('display', 700, 32, 1.15)} style={styles.centerText}>
          {t('store.reveal.title', { partner })}
        </T>
        <T f={boardFont('body', 400, 17, 1.5)} color={C.text2} style={styles.centerText}>
          {t('store.reveal.body')}
        </T>
      </View>
      <View style={[styles.card, { margin: 22, marginBottom: 0, borderRadius: 24, gap: 12 }]}>
        <View style={[styles.row, { gap: 10 }]}>
          <Dot size={38} name={partner} me={false} px={15} />
          <T f={boardFont('body', 600, 16)}>{partner}</T>
        </View>
        {/* The locked answer: grey bars, never text (the reveal rule holds in pictures too). */}
        <View style={{ gap: 10 }}>
          {['92%', '80%', '58%'].map((w) => (
            <View
              key={w}
              style={{
                height: 13,
                borderRadius: 7,
                backgroundColor: C.line,
                width: w as `${number}%`,
              }}
            />
          ))}
        </View>
        <View style={[styles.pill, styles.lockedChip]}>
          <T f={boardFont('body', 600, 13)} color={C.partnerText}>
            {t('store.reveal.locked')}
          </T>
        </View>
      </View>
      <View style={[styles.centerColumn, { gap: 12, marginTop: 30 }]}>
        <HoldRing />
        <T f={boardFont('body', 500, 15)} color={C.text3}>
          {t('store.reveal.hint')}
        </T>
      </View>
    </>
  );
}

function Bubble({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <View
      style={[
        styles.bubble,
        mine
          ? { alignSelf: 'flex-end', backgroundColor: C.youTint, borderBottomRightRadius: 6 }
          : { alignSelf: 'flex-start', backgroundColor: C.partnerTint, borderBottomLeftRadius: 6 },
      ]}
    >
      <T f={boardFont('body', 500, 17, 1.4)}>{children}</T>
    </View>
  );
}

function ThreadScreen() {
  const { t } = useTranslation();
  const { partner, streak } = STORE_DEMO;
  return (
    <>
      <View style={[styles.row, { gap: 14, paddingVertical: 8, paddingHorizontal: 20 }]}>
        <RoundButton icon="back" />
        <View>
          <T f={boardFont('display', 600, 18)}>{t('store.thread.title')}</T>
          <T f={boardFont('body', 500, 14)} color={C.text3}>
            {t('store.thread.subtitle', { count: streak })}
          </T>
        </View>
      </View>
      <View
        style={[
          styles.card,
          { marginHorizontal: 20, marginTop: 10, borderRadius: 24, padding: 18, gap: 10 },
        ]}
      >
        <View style={[styles.row, { gap: 10 }]}>
          <Dot size={36} name={partner} me={false} px={15} />
          <T f={boardFont('body', 600, 16)} style={styles.flex}>
            {partner}
          </T>
          <T f={boardFont('body', 500, 13)} color={C.text3}>
            {t('store.thread.time')}
          </T>
        </View>
        <T f={boardFont('body', 400, 18, 1.5)}>{t('store.thread.answer')}</T>
        <View style={[styles.row, { gap: 8 }]}>
          <View style={[styles.pill, styles.lovePill]}>
            <Icon name="heart" color={C.youText} size={16} filled />
            <T f={boardFont('body', 600, 14)} color={C.youText}>
              {STORE_DEMO.loves}
            </T>
          </View>
          <View style={[styles.center, styles.addReaction]}>
            <Icon name="smile" color={C.text2} size={18} />
          </View>
        </View>
      </View>
      <View style={[styles.flex, { gap: 10, paddingTop: 18, paddingHorizontal: 20 }]}>
        <Bubble mine={false}>{t('store.thread.message1')}</Bubble>
        <Bubble mine>{t('store.thread.message2')}</Bubble>
        <Bubble mine={false}>{t('store.thread.message3')}</Bubble>
      </View>
      <View style={[styles.row, { gap: 10, paddingHorizontal: 20, paddingBottom: 18 }]}>
        <View style={styles.composer}>
          <T f={boardFont('body', 500, 16)} color={C.text3}>
            {t('store.thread.reply', { partner })}
          </T>
        </View>
        <View style={[styles.center, styles.send]}>
          <Icon name="send" color={C.onYou} size={22} />
        </View>
      </View>
    </>
  );
}

function AppIcons({ count, gap }: { count: number; gap: number }) {
  return (
    <View style={[styles.row, { gap }]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.flex, styles.appIcon]} />
      ))}
    </View>
  );
}

function WidgetsScreen() {
  const { t } = useTranslation();
  const { partner, day, streak, replies, nextIn } = STORE_DEMO;
  return (
    <View style={[styles.flex, styles.wallpaper]}>
      <View style={[styles.row, { gap: 20, alignItems: 'stretch' }]}>
        <View style={[styles.flex, styles.smallWidget]}>
          <Mascot mood="waiting" awake="partner" size={84} still partnerName={partner} />
          <T f={boardFont('display', 700, 22)}>{t('store.widgets.day', { day })}</T>
          <T f={boardFont('body', 500, 13)} color={C.text2} style={styles.centerText}>
            {t('store.widgets.yourTurn', { partner })}
          </T>
        </View>
        <View style={[styles.flex, { gap: 24 }]}>
          <AppIcons count={2} gap={20} />
          <AppIcons count={2} gap={20} />
        </View>
      </View>
      <View style={[styles.row, styles.mediumWidget]}>
        <Mascot mood="celebrating" size={110} still partnerName={partner} />
        <View style={{ gap: 4 }}>
          <T f={boardFont('display', 700, 21)}>{t('store.widgets.bothAnswered')}</T>
          <T f={boardFont('body', 500, 14)} color={C.text2}>
            {t('store.widgets.stats', { count: streak, replies })}
          </T>
          <T f={{ ...boardFont('body', 700, 15), fontVariant: ['tabular-nums'] }} color={C.youText}>
            {t('store.widgets.next', { time: nextIn })}
          </T>
        </View>
      </View>
      <AppIcons count={4} gap={20} />
      <View style={styles.flex} />
      <View style={[styles.row, styles.dock]}>
        {Array.from({ length: 4 }, (_, i) => (
          <View key={i} style={[styles.flex, styles.dockIcon]} />
        ))}
      </View>
    </View>
  );
}

function MilestoneScreen() {
  const { t } = useTranslation();
  const { me, partner } = STORE_DEMO;
  return (
    <>
      <View style={[styles.centerColumn, { gap: 14, paddingTop: 34, paddingHorizontal: 26 }]}>
        <View
          style={[styles.pill, { height: 34, paddingHorizontal: 16, backgroundColor: C.blushTint }]}
        >
          <T f={boardFont('body', 600, 15)} color={C.blushText}>
            {t('store.milestone.chip')}
          </T>
        </View>
        <Mascot mood="snuggled" size={210} still partnerName={partner} />
        <T f={boardFont('display', 700, 32, 1.15)} style={styles.centerText}>
          {t('store.milestone.title', { me, partner })}
        </T>
      </View>
      <View style={[styles.card, styles.anniversaryCard]}>
        <View
          style={[
            styles.pill,
            { height: 30, alignSelf: 'flex-start', backgroundColor: C.blushTint },
          ]}
        >
          <T f={boardFont('body', 600, 13)} color={C.blushText}>
            {t('store.milestone.tag')}
          </T>
        </View>
        <T f={boardFont('display', 600, 23, 1.3)}>{t('store.milestone.question')}</T>
        <T f={boardFont('body', 500, 14)} color={C.text3}>
          {t('store.milestone.note')}
        </T>
      </View>
      <View style={[styles.cta, { marginHorizontal: 22, marginTop: 20, backgroundColor: C.you }]}>
        <T f={boardFont('display', 700, 19)} color={C.onYou}>
          {t('store.milestone.cta')}
        </T>
      </View>
    </>
  );
}

const PACKS = [
  ['deep', C.youTint],
  ['laugh', C.premiumTint],
  ['future', C.partnerTint],
  ['distance', C.surface2],
  ['spicy', C.blushTint],
  ['home', C.successTint],
] as const;

function PacksScreen() {
  const { t } = useTranslation();
  return (
    <>
      <View style={{ paddingTop: 10, paddingHorizontal: 22 }}>
        <T f={boardFont('display', 700, 32)}>{t('store.packs.title')}</T>
      </View>
      <View style={[styles.row, styles.featuredPack]}>
        <View style={[styles.center, styles.packIcon]}>
          <Icon name="heart" color={C.youText} size={28} />
        </View>
        <View style={{ gap: 4 }}>
          <View
            style={[styles.pill, { height: 26, paddingHorizontal: 10, backgroundColor: C.you }]}
          >
            <T f={boardFont('body', 700, 12)} color={C.onYou}>
              {t('store.packs.free')}
            </T>
          </View>
          <T f={boardFont('display', 700, 19)}>{t('store.packs.featured')}</T>
        </View>
      </View>
      <View style={styles.packGrid}>
        {PACKS.map(([key, tint]) => (
          <View key={key} style={styles.packTile}>
            <View style={[styles.packArt, { backgroundColor: tint }]} />
            <T f={boardFont('display', 600, 17)}>{t(`store.packs.${key}`)}</T>
          </View>
        ))}
      </View>
    </>
  );
}

function PlanCard({ best }: { best: boolean }) {
  const { t } = useTranslation();
  // Board: label, [PRICE], note. Prices only come from RevenueCat offerings, so a store frame
  // never shows one (MOB-26; open question for the lead in the status file).
  return (
    <View style={[styles.flex, styles.plan, best ? styles.planBest : styles.planOther]}>
      {best ? (
        <View style={[styles.pill, styles.bestValue]}>
          <T f={{ ...boardFont('body', 700, 11), letterSpacing: 0.66 }} color={C.onPremium}>
            {t('store.paywall.bestValue')}
          </T>
        </View>
      ) : null}
      <T f={boardFont('body', 600, 15)} color={C.text2}>
        {t(best ? 'store.paywall.yearly' : 'store.paywall.monthly')}
      </T>
      <T f={boardFont('body', 700, 13)} color={best ? C.premiumText : C.text3}>
        {t(best ? 'store.paywall.yearlyNote' : 'store.paywall.monthlyNote')}
      </T>
    </View>
  );
}

function PaywallScreen() {
  const { t } = useTranslation();
  const { me, partner } = STORE_DEMO;
  const steps = [
    ['todayDay', 'todayLine'],
    ['day5', 'day5Line'],
    ['day7', 'day7Line'],
  ] as const;
  return (
    <>
      <View style={[styles.rowBetween, { paddingVertical: 8, paddingHorizontal: 22 }]}>
        <T f={boardFont('body', 600, 15)} color={C.text2}>
          {t('store.paywall.restore')}
        </T>
        <RoundButton icon="close" />
      </View>
      <View style={[styles.centerColumn, { gap: 12, paddingTop: 6, paddingHorizontal: 28 }]}>
        <View style={styles.row}>
          <Dot size={60} name={me} me px={23} />
          <Dot size={60} name={partner} me={false} px={23} style={styles.overlap12} />
        </View>
        <T f={boardFont('display', 700, 33, 1.12)} style={styles.centerText}>
          {t('store.paywall.title')}
        </T>
        <T f={boardFont('body', 400, 17, 1.5)} color={C.text2} style={styles.centerText}>
          {t('store.paywall.body', { partner })}
        </T>
      </View>
      <View style={[styles.row, { gap: 14, paddingTop: 26, paddingHorizontal: 22 }]}>
        <PlanCard best />
        <PlanCard best={false} />
      </View>
      <View style={[styles.card, styles.timeline]}>
        {steps.map(([day, line]) => (
          <T key={day} f={boardFont('body', 500, 15)}>
            <T f={boardFont('body', 700, 15)}>{t(`store.paywall.${day}`)}</T>
            {t(`store.paywall.${line}`)}
          </T>
        ))}
      </View>
      <View style={[styles.cta, { marginHorizontal: 22, backgroundColor: C.premium }]}>
        <T f={boardFont('display', 700, 19)} color={C.onPremium}>
          {t('store.paywall.cta')}
        </T>
      </View>
    </>
  );
}

const SCREENS: Record<Exclude<StoreShotId, 'feeling'>, () => ReactNode> = {
  today: TodayScreen,
  reveal: RevealScreen,
  thread: ThreadScreen,
  widgets: WidgetsScreen,
  milestone: MilestoneScreen,
  packs: PacksScreen,
  paywall: PaywallScreen,
};

/** One phone screen of the StoreScreen board at its real size (440 x 956 or 412 x 915). */
export function StoreScreen({
  shot,
  platform,
}: {
  shot: Exclude<StoreShotId, 'feeling'>;
  platform: StorePlatform;
}) {
  const { width, height } = STORE_FRAME[platform].screen;
  const ios = platform === 'ios';
  const Body = SCREENS[shot];
  return (
    <View
      testID={`store-screen-${shot}`}
      style={[
        styles.screen,
        { width, height, backgroundColor: shot === 'widgets' ? C.skeleton : C.bg },
      ]}
    >
      <StatusBar platform={platform} />
      <Body />
      <View style={[styles.homeIndicatorRow, { bottom: ios ? 8 : 6 }]} pointerEvents="none">
        <View style={[styles.homeIndicator, { width: ios ? 140 : 108 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { overflow: 'hidden' },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { alignItems: 'center', justifyContent: 'center' },
  centerColumn: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  statusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overlap9: { marginLeft: -9, borderWidth: 2, borderColor: C.bg },
  overlap12: { marginLeft: -12, borderWidth: 3, borderColor: C.bg },
  streakChip: {
    gap: 4,
    height: 40,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 20,
    backgroundColor: C.youTint,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    padding: 20,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  divider: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 14 },
  cta: {
    marginTop: 18,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    height: 88,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.tabBar,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 12,
  },
  roundButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
  },
  lockedChip: {
    position: 'absolute',
    right: 18,
    top: 20,
    height: 30,
    backgroundColor: C.partnerTint,
  },
  bubble: {
    maxWidth: '78%',
    paddingVertical: 13,
    paddingHorizontal: 17,
    borderRadius: 22,
  },
  lovePill: {
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    backgroundColor: C.youTint,
    borderWidth: 1,
    borderColor: C.you,
  },
  addReaction: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface2 },
  composer: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  send: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.you },
  wallpaper: { gap: 26, paddingTop: 26, paddingHorizontal: 28, backgroundColor: C.skeleton },
  smallWidget: {
    aspectRatio: 1,
    borderRadius: 26,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 8,
  },
  appIcon: { aspectRatio: 1, borderRadius: 18, backgroundColor: C.doughLine },
  mediumWidget: { gap: 16, padding: 18, borderRadius: 26, backgroundColor: C.surface },
  dock: {
    marginHorizontal: -8,
    marginBottom: 28,
    height: 96,
    borderRadius: 34,
    backgroundColor: C.line,
    gap: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  dockIcon: { alignSelf: 'stretch', borderRadius: 18, backgroundColor: C.doughLine },
  anniversaryCard: {
    marginHorizontal: 22,
    marginTop: 24,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: C.blush,
    gap: 10,
  },
  featuredPack: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    gap: 14,
    borderRadius: 22,
    backgroundColor: C.youTint,
    borderWidth: 1,
    borderColor: C.you,
  },
  packIcon: { width: 60, height: 60, borderRadius: 16, backgroundColor: C.surface },
  packGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  packTile: {
    width: '47.9%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 22,
    padding: 12,
    gap: 8,
  },
  packArt: { height: 74, borderRadius: 16 },
  plan: { gap: 4, paddingTop: 20, paddingHorizontal: 16, paddingBottom: 16, borderRadius: 22 },
  planBest: { backgroundColor: C.premiumTint, borderWidth: 2, borderColor: C.premium },
  planOther: { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line },
  bestValue: {
    position: 'absolute',
    top: -12,
    left: 14,
    height: 24,
    paddingHorizontal: 10,
    backgroundColor: C.premium,
  },
  timeline: {
    marginHorizontal: 22,
    marginTop: 18,
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 10,
  },
  homeIndicatorRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  homeIndicator: { height: 5, borderRadius: 3, backgroundColor: C.text },
});
