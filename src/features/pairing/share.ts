import { t } from '@/i18n';

import { displayCode, inviteLink } from './invite';

/**
 * The text for the share sheet: the code, plus the link when this session has a token for it.
 * Without a token (after a restart, or before BE-28) the code alone is enough to join.
 */
export function shareInviteMessage(
  code: string,
  token: string | null,
  myName: string | null | undefined,
): string {
  const name = myName?.trim();
  const shown = displayCode(code);
  if (token) {
    const params = { code: shown, link: inviteLink(code, token) };
    return name
      ? t('pairing.invite.shareMessage', { ...params, name })
      : t('pairing.invite.shareMessageNoName', params);
  }
  return name
    ? t('pairing.invite.shareMessageCode', { code: shown, name })
    : t('pairing.invite.shareMessageCodeNoName', { code: shown });
}
