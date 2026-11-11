import type { TFunction } from 'i18next';
import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { personColors, Text, useTheme } from '@/ui';

import { hugSeconds, type LittleThingKind, type Moment } from '../model';
import { GesturePose } from './GesturePose';

const POSE_SIZE = 40;

/** One gesture as a noun phrase for a grouped line ("3 kisses", "a hug"). */
function part(t: TFunction, kind: LittleThingKind, count: number): string {
  return t(`littleThings.received.part.${kind}`, { count });
}

/**
 * The bubble's line (board 24d, prototype copy): "Sam sent you 3 kisses", "Sam kissed you back",
 * "You hugged at the same time", or grouped like the push: "Sam sent you 3 kisses and a hug".
 */
export function momentText(t: TFunction, moment: Moment, partner: string): string {
  if (moment.sameTime) return t('littleThings.sameTime');
  if (moment.counts.length > 1) {
    const parts = moment.counts.map((c) => part(t, c.kind, c.count));
    const last = parts.pop() ?? '';
    const list = t('littleThings.received.and', { first: parts.join(', '), last });
    return t('littleThings.received.list', { partner, list });
  }
  const count = moment.counts[0]?.count ?? 1;
  if (moment.back) return t(`littleThings.received.back.${moment.kind}`, { partner });
  switch (moment.kind) {
    case 'kiss':
      return t('littleThings.received.kiss', { partner, count });
    case 'hug':
      return count > 1
        ? t('littleThings.received.hugs', { partner, count })
        : t('littleThings.received.hug', { partner, seconds: hugSeconds(moment.amount) });
    default:
      return t(`littleThings.received.${moment.kind}`, { partner });
  }
}

type Props = {
  moment: Moment;
  partner: string;
  top: number;
  maxWidth: number;
  onReply: () => void;
};

/**
 * 24d: the partner's gesture on Today, a speech bubble near the top with Reply. The dot is the
 * partner's colour (relative to the viewer); Reply is mine. Until LEAD-11's poses land, a small
 * still pose leads the line (GAPS 24d).
 */
export function ReceivedBubble({ moment, partner, top, maxWidth, onReply }: Props) {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const them = personColors(colors, false);
  const me = personColors(colors, true);
  const text = momentText(t, moment, partner);
  return (
    <View
      testID="24d-bubble"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top,
        left: space.xl,
        maxWidth,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.chip + 5,
        paddingVertical: space.xs + 2,
        paddingLeft: space.md,
        paddingRight: space.xs + 2,
        shadowColor: colors.text,
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }}
    >
      <GesturePose kind={moment.kind} size={POSE_SIZE} />
      <View
        style={{
          // An 8 pt dot in the partner's colour with a 3 pt tint ring (board 24d).
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: them.fill,
          borderWidth: 3,
          borderColor: them.tint,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text testID="24d-text" variant="label" style={{ flexShrink: 1 }}>
        {text}
      </Text>
      <Pressable
        testID="24d-reply"
        accessibilityRole="button"
        accessibilityLabel={t(`littleThings.received.reply.${moment.kind}`)}
        accessibilityHint={t('littleThings.received.replyHint', { partner })}
        onPress={onReply}
        hitSlop={6}
        style={({ pressed }) => ({
          minHeight: 32,
          minWidth: 44,
          paddingHorizontal: space.md,
          borderRadius: radius.pill,
          backgroundColor: me.tint,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text variant="button" style={{ color: me.text }}>
          {t('littleThings.received.replyButton')}
        </Text>
      </Pressable>
    </View>
  );
}
