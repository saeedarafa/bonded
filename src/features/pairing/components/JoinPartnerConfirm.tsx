import { useTranslation } from '@/i18n';

import { ConfirmSheet } from './ConfirmSheet';

type Props = {
  visible: boolean;
  /** The inviter's first name, or empty when unknown. */
  partner: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID: string;
};

/**
 * D37: before `accept_invite` for someone who already has their own (solo) space. Joining ends it:
 * its answers stay readable for 30 days, are never shown to the new partner, and the person's own
 * invite code stops working (D04, D08). Cancel keeps everything.
 */
export function JoinPartnerConfirm({
  visible,
  partner,
  loading,
  onConfirm,
  onCancel,
  testID,
}: Props) {
  const { t } = useTranslation();
  const name = partner.trim();
  return (
    <ConfirmSheet
      visible={visible}
      testID={testID}
      title={
        name
          ? t('pairing.joinPartner.confirmTitle', { name })
          : t('pairing.joinPartner.confirmTitleNoName')
      }
      body={
        name
          ? t('pairing.joinPartner.confirmBody', { name })
          : t('pairing.joinPartner.confirmBodyNoName')
      }
      confirmLabel={t('pairing.joinPartner.confirm')}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
