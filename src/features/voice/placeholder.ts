import { t } from '@/i18n';

/**
 * MOB-55a (BE-42, D46): `answers.body` and `thread_messages.body` are null for a voice row
 * (`kind = 'voice'`). Until playback exists (MOB-55/56), such a row reads as a neutral
 * "Voice note" wherever the app shows text. Text rows pass through unchanged.
 */
export function bodyOrVoice(body: string | null): string {
  return body ?? t('voice.placeholder');
}
