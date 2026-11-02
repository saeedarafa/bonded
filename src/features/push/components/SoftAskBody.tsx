import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { OptionRow, Text, useTheme } from '@/ui';

import { RITUAL_TIMES, type RitualTimeId } from '../ritual';
import { NotificationCard } from './NotificationCard';

type Props = {
  /** Screen id for test ids: `09` or `J6`. */
  screenId: '09' | 'J6';
  partner: string;
  /** Shown on the preview card. */
  previewTime: string;
  title: string;
  body: string;
  /** The three preset times; omit to hide them (J6 "Same as Maya"). */
  times?: { selected: RitualTimeId; onSelect: (id: RitualTimeId) => void; heading: boolean };
  children?: ReactNode;
};

/** What 09 and J6 share: the notification preview, the heading and the ritual time rows. */
export function SoftAskBody({
  screenId,
  partner,
  previewTime,
  title,
  body,
  times,
  children,
}: Props) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <View style={{ gap: space.xl }}>
      <NotificationCard
        testID={`${screenId}-preview`}
        title={t('push.preview.title', { partner })}
        body={t('push.preview.body')}
        time={previewTime}
      />
      <View style={{ gap: space.sm }}>
        <Text variant="h1" accessibilityRole="header">
          {title}
        </Text>
        <Text tone="text2">{body}</Text>
      </View>
      {children}
      {times ? (
        <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
          {times.heading ? (
            <Text variant="label" tone="text2">
              {t('push.softAsk.timeHeading')}
            </Text>
          ) : null}
          {RITUAL_TIMES.map((r) => (
            <OptionRow
              key={r.id}
              testID={`${screenId}-time-${r.id}`}
              label={t(`push.ritual.${r.id}`)}
              trailing={r.time}
              selected={times.selected === r.id}
              onPress={() => times.onSelect(r.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
