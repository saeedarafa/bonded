import { useMutation } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { useSession } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { AppError, toAppError } from '@/lib/errors';
import { colors } from '@/ui/theme';

import { getHistoryExport } from './api';
import { exportEntries, historyHtml } from './exportPdf';

/**
 * MOB-27 (D08, 58): read the ended couple's History, build the PDF on the phone (expo-print) and
 * open the share sheet (expo-sharing) so it can be saved to Files or sent anywhere. The PDF is
 * always light (a printable keepsake). Errors carry no answer text; nothing is logged or tracked.
 */
export function useHistoryExport(coupleId: string | undefined, partner: string) {
  const { t, i18n } = useTranslation();
  const { userId } = useSession();
  return useMutation<void, AppError>({
    mutationFn: async () => {
      if (!coupleId) throw new AppError('UNKNOWN', t('history.export.error'));
      const locale = i18n.language || 'en';
      const entries = exportEntries(await getHistoryExport(coupleId), userId);
      const html = historyHtml(
        entries,
        {
          lang: locale,
          title: t('history.export.title', { partner }),
          subtitle: t('history.export.subtitle', { count: entries.length }),
          you: t('history.export.you'),
          partner,
          onlyYou: t('history.export.onlyYou'),
          replies: t('history.export.replies'),
          empty: t('history.export.empty'),
          footer: t('history.export.footer'),
        },
        colors.light,
        locale,
      );
      try {
        const { uri } = await Print.printToFileAsync({ html });
        if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: t('history.export.shareTitle'),
        });
      } catch {
        // The native error may echo the file path, never the text; still, show only our copy.
        throw new AppError('UNKNOWN', t('history.export.error'));
      }
    },
    retry: false,
  });
}

/** The message to show for a failed export: the network one when offline, else ours. */
export function exportErrorMessage(error: unknown, fallback: string): string {
  const e = toAppError(error);
  return e.kind === 'NETWORK' || e.kind === 'SIGNED_OUT' ? e.message : fallback;
}
