import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Banner, Button, haptics, Icon, Sheet, Text, useTheme, useToast } from '@/ui';

import { useSendFeedback } from '../hooks';
import { CHECK_IN_SCORES, type CheckInScore } from '../model';

type Props = {
  visible: boolean;
  /** Skip, the scrim, Android back and a successful Send all close it. */
  onDismiss: () => void;
};

/**
 * 26 Monthly check-in (MOB-23, D22): a sheet over Today with a five-face scale. Send stores a
 * private `check_in` row (score 1 to 5) for our team; it never routes to the app store and never
 * asks for a rating there (D31).
 */
export function CheckInSheet({ visible, onDismiss }: Props) {
  return (
    <Sheet visible={visible} onDismiss={onDismiss} testID="26-sheet">
      {visible ? <CheckInBody onDismiss={onDismiss} /> : null}
    </Sheet>
  );
}

function CheckInBody({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  const { colors, space, size } = useTheme();
  const showToast = useToast((s) => s.show);
  const send = useSendFeedback();
  const [score, setScore] = useState<CheckInScore | null>(null);
  const [pickFirst, setPickFirst] = useState(false);

  const submit = () => {
    if (send.isPending) return;
    if (score === null) {
      haptics.error();
      setPickFirst(true);
      return;
    }
    send.mutate(
      { kind: 'check_in', score, tags: [], body: '' },
      {
        onSuccess: () => {
          haptics.success();
          showToast(t('feedback.checkIn.sent'));
          onDismiss();
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs + 2 }}>
        <Text
          variant="h2"
          accessibilityRole="header"
          style={{ textAlign: 'center' }}
          testID="26-title"
        >
          {t('feedback.checkIn.title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('feedback.checkIn.body')}
        </Text>
      </View>
      <View
        testID="26-scale"
        accessibilityRole="radiogroup"
        accessibilityLabel={t('feedback.checkIn.scale')}
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: space.xs,
        }}
      >
        {CHECK_IN_SCORES.map((n) => {
          const on = score === n;
          return (
            <Pressable
              key={n}
              testID={`26-face-${n}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={t(`feedback.checkIn.score${n}`)}
              onPress={() => {
                haptics.selection();
                setScore(n);
                setPickFirst(false);
              }}
              style={{
                width: 56,
                height: 56,
                minWidth: size.tapTarget,
                borderRadius: 28,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? colors.youTint : colors.surface2,
                borderWidth: on ? 2 : 1,
                borderColor: on ? colors.you : colors.line,
              }}
            >
              <Icon name={`face${n}`} size={28} color={on ? colors.youText : colors.text2} />
            </Pressable>
          );
        })}
      </View>
      {pickFirst ? (
        <Text
          variant="caption"
          tone="blushText"
          style={{ textAlign: 'center' }}
          accessibilityLiveRegion="polite"
          testID="26-pick"
        >
          {t('feedback.checkIn.pick')}
        </Text>
      ) : null}
      {send.error ? <Banner tone="error" message={send.error.message} testID="26-error" /> : null}
      <View style={{ gap: space.xs }}>
        <Button
          testID="26-send"
          label={t('feedback.checkIn.send')}
          loading={send.isPending}
          onPress={submit}
        />
        <Button
          testID="26-skip"
          variant="link"
          label={t('feedback.checkIn.skip')}
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}
