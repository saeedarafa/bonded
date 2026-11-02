import { useState, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';

import {
  AnswerCard,
  AnswerField,
  Avatar,
  AvatarPair,
  BadgeLadder,
  Banner,
  Button,
  ChatBubble,
  Chip,
  CodeInput,
  Composer,
  Confetti,
  FeedbackPill,
  Heatmap,
  HoldToReveal,
  Mascot,
  mascotMoods,
  OfflineBanner,
  OptionRow,
  PackTile,
  PerkTile,
  PlanCard,
  ProgressBar,
  QuestionCard,
  ReactionPill,
  Sheet,
  Skeleton,
  SkeletonGroup,
  TabBar,
  Text,
  TextField,
  Toast,
  Toggle,
  TopBar,
  TypingIndicator,
  reactionKinds,
  useTheme,
  useToast,
  type HeatDay,
  type ReactionKind,
} from '@/ui';

import { copy } from './copy';

export type GalleryEntry = {
  /** The component this entry is named after. */
  name: string;
  /** Every exported component this demo shows (a test checks the union covers `@/ui/components`). */
  covers: readonly string[];
  Demo: () => ReactElement;
};

function Stack({ children }: { children: ReactNode }) {
  const { space } = useTheme();
  return <View style={{ gap: space.md }}>{children}</View>;
}

function ButtonsDemo() {
  const [loading, setLoading] = useState(false);
  return (
    <Stack>
      <Button label={copy.answer} onPress={() => undefined} />
      <Button label={copy.sending} loading onPress={() => undefined} />
      <Button label={copy.startTrial} variant="premium" onPress={() => undefined} />
      <Button label={copy.revisit} variant="ghost" onPress={() => undefined} />
      <Button label={copy.deleteForever} variant="destructive" onPress={() => undefined} />
      <Button label={copy.maybeLater} variant="link" onPress={() => undefined} />
      <Button
        label={loading ? copy.sending : copy.answer}
        loading={loading}
        icon="send"
        onPress={() => setLoading(true)}
      />
    </Stack>
  );
}

function ChipsDemo() {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Chip label={copy.dayToday} />
      <Chip label={copy.streak} tone="streak" />
      <Chip label={copy.countdown} tone="countdown" />
      <Chip label={copy.premium} tone="premium" />
      <Chip label={copy.saidYes} tone="partner" />
      <Chip label={copy.waiting} tone="status" />
    </View>
  );
}

function AvatarsDemo() {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
      <Avatar name={copy.maya} isMe size="sm" />
      <Avatar name={copy.maya} isMe />
      <Avatar name={copy.sam} isMe={false} size="lg" />
      <AvatarPair meName={copy.maya} partnerName={copy.sam} />
    </View>
  );
}

function MascotDemo() {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
        {mascotMoods.map((mood) => (
          <Mascot key={mood} mood={mood} partnerName={copy.sam} />
        ))}
        <Mascot mood="waiting" awake="partner" partnerName={copy.sam} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <Mascot mood="together" size={24} partnerName={copy.sam} />
        <Mascot mood="together" size={36} partnerName={copy.sam} />
        <Mascot mood="together" size={56} partnerName={copy.sam} />
      </View>
    </View>
  );
}

function InputsDemo() {
  const [name, setName] = useState('');
  const [answer, setAnswer] = useState<string>(copy.mayaAnswer);
  const [code, setCode] = useState('48');
  return (
    <Stack>
      <TextField
        label={copy.fieldName}
        placeholder={copy.partnerName}
        value={name}
        onChangeText={setName}
        showLabel
      />
      <TextField
        label={copy.fieldName}
        value={copy.sam}
        onChangeText={() => undefined}
        error={copy.errorCopy}
      />
      <AnswerField label={copy.question} value={answer} onChangeText={setAnswer} />
      <CodeInput value={code} onChange={setCode} />
      <CodeInput value="48" onChange={() => undefined} error={copy.codeError} />
    </Stack>
  );
}

function SelectionDemo() {
  const [on, setOn] = useState(true);
  const [radio, setRadio] = useState(0);
  const [pill, setPill] = useState(true);
  const [plan, setPlan] = useState<'yearly' | 'monthly'>('yearly');
  const { space } = useTheme();
  return (
    <Stack>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label">{copy.reminder}</Text>
        <Toggle label={copy.reminder} value={on} onValueChange={setOn} />
      </View>
      <OptionRow
        label={copy.optionOne}
        description={copy.optionDesc}
        selected={radio === 0}
        onPress={() => setRadio(0)}
      />
      <OptionRow
        label={copy.optionTwo}
        trailing={copy.optionTime}
        selected={radio === 1}
        onPress={() => setRadio(1)}
      />
      <OptionRow
        label={copy.goalOne}
        kind="checkbox"
        selected={pill}
        onPress={() => setPill(!pill)}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <FeedbackPill
          label={copy.feedbackReminders}
          icon="bell"
          selected={!pill}
          onPress={() => setPill(!pill)}
        />
        <FeedbackPill
          label={copy.feedbackForgets}
          icon="heart"
          selected={pill}
          onPress={() => setPill(!pill)}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: space.md, paddingTop: space.sm }}>
        <PlanCard
          title={copy.planYearly}
          price={copy.planPrice}
          caption={copy.trial}
          badge={copy.bestValue}
          selected={plan === 'yearly'}
          onPress={() => setPlan('yearly')}
        />
        <PlanCard
          title={copy.planMonthly}
          price={copy.planPrice}
          caption={copy.noTrial}
          selected={plan === 'monthly'}
          onPress={() => setPlan('monthly')}
        />
      </View>
    </Stack>
  );
}

function CardsDemo() {
  return (
    <Stack>
      <QuestionCard dayLabel={copy.dayToday} meta={copy.newIn} question={copy.question} />
      <AnswerCard name={copy.sam} isMe={false} time="21:04" body={copy.samAnswer}>
        <ReactionPill kind="love" count={1} selected onPress={() => undefined} />
      </AnswerCard>
      <AnswerCard name={copy.maya} isMe time="20:51" body={copy.mayaAnswer} />
      <AnswerCard name={copy.sam} isMe={false} locked />
      <PerkTile icon="heart" title={copy.perkHead} description={copy.perkBody} premium />
      <PerkTile icon="sparkle" title={copy.perkHead} description={copy.perkBody} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <PackTile title={copy.packName} detail={copy.packDetail} onPress={() => undefined} />
        <PackTile
          title={copy.packName}
          detail={copy.packDetail}
          premiumLabel={copy.premium}
          onPress={() => undefined}
        />
      </View>
    </Stack>
  );
}

function ChatDemo() {
  const [sent, setSent] = useState<string[]>([]);
  const [picked, setPicked] = useState<ReactionKind[]>(['love']);
  const { space } = useTheme();
  return (
    <Stack>
      <ChatBubble isMe={false} senderName={copy.sam} text={copy.chatThem} time="21:05" />
      <ChatBubble isMe senderName={copy.you} text={copy.chatMe} time="21:06" />
      <ChatBubble
        isMe
        senderName={copy.you}
        text={copy.chatMe}
        status="sending"
        statusLabel={copy.chatSending}
      />
      <ChatBubble
        isMe
        senderName={copy.you}
        text={copy.chatMe}
        status="failed"
        statusLabel={copy.chatFailed}
        onRetry={() => undefined}
      />
      {sent.map((body, i) => (
        <ChatBubble key={`${i}-${body}`} isMe senderName={copy.you} text={body} />
      ))}
      <TypingIndicator name={copy.sam} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {reactionKinds.map((kind) => (
          <ReactionPill
            key={kind}
            kind={kind}
            count={picked.includes(kind) ? 1 : 0}
            selected={picked.includes(kind)}
            onPress={() =>
              setPicked(
                picked.includes(kind) ? picked.filter((k) => k !== kind) : [...picked, kind],
              )
            }
          />
        ))}
      </View>
      <Composer onSend={(body) => setSent([...sent, body])} />
    </Stack>
  );
}

function ProgressDemo() {
  const [revealed, setRevealed] = useState(false);
  const [key, setKey] = useState(0);
  const { space } = useTheme();
  return (
    <Stack>
      <ProgressBar value={0.6} label={copy.progressName} />
      <BadgeLadder current={12} />
      <HoldToReveal key={key} onComplete={() => setRevealed(true)} />
      {revealed ? (
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="success" style={{ textAlign: 'center' }}>
            {copy.revealed}
          </Text>
          <Button
            label={copy.resetReveal}
            variant="ghost"
            onPress={() => {
              setRevealed(false);
              setKey(key + 1);
            }}
          />
        </View>
      ) : null}
    </Stack>
  );
}

function monthCells(): HeatDay[] {
  // October 2026 starts on a Thursday: three empty cells first (Monday-first grid).
  const pattern = 'bbbobbbbnbbbbbbobbbbbbbnbbbbbbt';
  const cells: HeatDay[] = [0, 1, 2].map((i) => ({ key: `pad-${i}`, day: 0, state: 'empty' }));
  [...pattern].forEach((c, i) => {
    const state = { b: 'both', o: 'one', n: 'missed', t: 'today' }[c] as HeatDay['state'];
    cells.push({ key: `2026-10-${i + 1}`, day: i + 1, state });
  });
  return cells;
}

function HeatmapDemo() {
  return <Heatmap days={monthCells()} label={copy.heatmapSummary} />;
}

function SkeletonDemo() {
  return (
    <SkeletonGroup>
      <Skeleton height={22} width="70%" />
      <Skeleton />
      <Skeleton width="90%" />
      <Skeleton width="40%" />
    </SkeletonGroup>
  );
}

function NavigationDemo() {
  const [tab, setTab] = useState('today');
  const items = [
    { key: 'today', label: copy.tabToday, icon: 'today' },
    { key: 'history', label: copy.tabHistory, icon: 'history' },
    { key: 'packs', label: copy.tabPacks, icon: 'packs' },
    { key: 'us', label: copy.tabUs, icon: 'us' },
  ] as const;
  return (
    <Stack>
      <TopBar
        title={copy.sam}
        onBack={() => undefined}
        right={<Avatar name={copy.maya} isMe size="sm" />}
      />
      <TabBar
        items={items.map((item) => ({
          ...item,
          focused: tab === item.key,
          onPress: () => setTab(item.key),
        }))}
      />
    </Stack>
  );
}

function OverlaysDemo() {
  const [open, setOpen] = useState(false);
  const [confetti, setConfetti] = useState(false);
  return (
    <Stack>
      <Toast message={copy.toastDone} />
      <Toast message={copy.toastError} tone="error" />
      <Button
        label={copy.showToast}
        variant="ghost"
        onPress={() => useToast.getState().show(copy.toastDone)}
      />
      <Banner message={copy.offlineCopy} />
      <Banner message={copy.errorCopy} tone="error" />
      <OfflineBanner />
      <Button label={copy.openSheet} variant="ghost" onPress={() => setOpen(true)} />
      <Sheet visible={open} onDismiss={() => setOpen(false)} title={copy.sheetHead}>
        <Text>{copy.sheetBody}</Text>
        <Button label={copy.close} onPress={() => setOpen(false)} />
      </Sheet>
      <Button label={copy.playConfetti} variant="ghost" onPress={() => setConfetti(true)} />
      <Confetti active={confetti} bursts={1} onDone={() => setConfetti(false)} />
    </Stack>
  );
}

/** One entry per group, in the order of DESIGN.md §7. */
export const galleryEntries: readonly GalleryEntry[] = [
  { name: 'Button', covers: ['Button'], Demo: ButtonsDemo },
  { name: 'Chip', covers: ['Chip'], Demo: ChipsDemo },
  { name: 'Avatar', covers: ['Avatar', 'AvatarPair'], Demo: AvatarsDemo },
  { name: 'Mascot', covers: ['Mascot'], Demo: MascotDemo },
  { name: 'Inputs', covers: ['TextField', 'AnswerField', 'CodeInput'], Demo: InputsDemo },
  {
    name: 'Selection',
    covers: ['Toggle', 'OptionRow', 'FeedbackPill', 'PlanCard'],
    Demo: SelectionDemo,
  },
  {
    name: 'Cards',
    covers: ['QuestionCard', 'AnswerCard', 'PerkTile', 'PackTile'],
    Demo: CardsDemo,
  },
  {
    name: 'Chat',
    covers: ['ChatBubble', 'ReactionPill', 'TypingIndicator', 'Composer'],
    Demo: ChatDemo,
  },
  {
    name: 'Progress',
    covers: ['ProgressBar', 'BadgeLadder', 'HoldToReveal'],
    Demo: ProgressDemo,
  },
  { name: 'Heatmap', covers: ['Heatmap'], Demo: HeatmapDemo },
  { name: 'Skeleton', covers: ['Skeleton', 'SkeletonGroup'], Demo: SkeletonDemo },
  { name: 'Navigation', covers: ['TabBar', 'TopBar'], Demo: NavigationDemo },
  {
    name: 'Overlays',
    covers: ['Sheet', 'Toast', 'ToastHost', 'Banner', 'OfflineBanner', 'Confetti'],
    Demo: OverlaysDemo,
  },
];
