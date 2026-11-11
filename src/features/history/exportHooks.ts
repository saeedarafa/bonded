import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { useSession } from '@/features/auth/session';
import type { EndedCouple } from '@/features/settings/api';
import { formerPartnerNameQuery } from '@/features/settings/hooks';
import { formerPartnerId } from '@/features/settings/partnerLeft';
import { useTranslation } from '@/i18n';
import { AppError, toAppError } from '@/lib/errors';
import { colors } from '@/ui/theme';

import { getHistoryExport } from './api';
import { exportEntries, historyHtml, lockedExportDays } from './exportPdf';

/**
 * MOB-27b: the former partner's name for the PDF, awaited here (not taken from the screen) so a
 * quick tap before the name query settles still prints "you and Sam". Uses the screen's cached
 * read, or joins / starts it. Null when it is gone (D09: deleted account) or the read fails: the
 * name is a nicety, it never blocks the export.
 */
export async function exportPartnerName(
  client: QueryClient,
  couple: EndedCouple,
  myId: string | null,
): Promise<string | null> {
  const partnerId = formerPartnerId(couple, myId);
  if (!partnerId) return null;
  try {
    return await client.ensureQueryData(formerPartnerNameQuery(partnerId));
  } catch {
    return null;
  }
}

/**
 * MOB-27b (privacy): remove the PDF expo-print wrote to the app cache. Runs after the share sheet
 * closes and on every failure, so no copy of the answers stays on the phone outside the app's
 * data. Best effort: a failed delete is ignored (the OS clears the cache eventually), never shown.
 */
export function deleteExportFile(uri: string | null): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Nothing to tell the user, and the path is not logged.
  }
}

/**
 * MOB-27 (D08, 58): read the ended couple's History, build the PDF on the phone (expo-print) and
 * open the share sheet (expo-sharing) so it can be saved to Files or sent anywhere. The PDF is
 * always light (a printable keepsake). Errors carry no answer text; nothing is logged or tracked.
 * MOB-27b: the partner's name is awaited, and the file is deleted once the sheet closes or fails.
 * MOB-71 (D55): only the days I can open; the PDF says how many older days need Premium.
 */
export function useHistoryExport(couple: EndedCouple | undefined) {
  const { t, i18n } = useTranslation();
  const { userId } = useSession();
  const client = useQueryClient();
  return useMutation<void, AppError>({
    mutationFn: async () => {
      if (!couple) throw new AppError('UNKNOWN', t('history.export.error'));
      const locale = i18n.language || 'en';
      const [rows, name] = await Promise.all([
        getHistoryExport(couple.id),
        exportPartnerName(client, couple, userId),
      ]);
      const partner = name || t('pairing.partnerFallback');
      const entries = exportEntries(rows, userId);
      const locked = lockedExportDays(rows);
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
          ...(locked > 0 ? { lockedNote: t('history.export.lockedNote', { count: locked }) } : {}),
        },
        colors.light,
        locale,
      );
      let uri: string | null = null;
      try {
        uri = (await Print.printToFileAsync({ html })).uri;
        if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
        // Resolves when the share sheet is dismissed (shared, saved or cancelled).
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: t('history.export.shareTitle'),
        });
      } catch {
        // The native error may echo the file path, never the text; still, show only our copy.
        throw new AppError('UNKNOWN', t('history.export.error'));
      } finally {
        deleteExportFile(uri);
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
