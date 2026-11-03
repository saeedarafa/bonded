import { useTranslation } from '@/i18n';
import { Button, Sheet, Text } from '@/ui';

type Props = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** `destructive` for actions that stop something working (a code, a space). */
  tone?: 'primary' | 'destructive';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID: string;
};

/**
 * Ask before an action that can't be undone from here (D36 new code, D37 join a partner).
 * Cancel, the scrim and Android back all keep everything as it was.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: Props) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onDismiss={onCancel} title={title} testID={testID}>
      <Text tone="text2">{body}</Text>
      <Button
        testID={`${testID}-confirm`}
        variant={tone}
        label={confirmLabel}
        loading={loading}
        onPress={onConfirm}
      />
      <Button
        testID={`${testID}-cancel`}
        variant="ghost"
        label={t('ui.cancel')}
        onPress={onCancel}
      />
    </Sheet>
  );
}
