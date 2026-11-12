import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';

import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { toAppError } from '@/lib/errors';

import { voicePlaybackUrl } from './api';

/** A take on this phone (19c, before sending) or an object in the bucket (21, after reveal). */
export type VoiceSource = { uri: string } | { path: string };

/**
 * Play / pause one voice note. For a bucket object a signed URL (≤ 60 s, SEC-09) is made each time
 * playback starts from the beginning and handed straight to the player: it is never kept in React
 * state, a query cache, storage or a log. Pause and resume reuse the loaded audio.
 *
 * The reveal rule is the server's: the bucket only signs a partner's voice answer once I have
 * answered (D13, BE-42). Free users can listen (D46): nothing here checks Premium.
 */
export function useVoicePlayback(
  source: VoiceSource,
  /** Analytics (MOB-24c, `voice_played`): which note, never its path or URL. */
  played?: { context: 'answer' | 'message'; own: boolean },
) {
  const { t } = useTranslation();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = 'uri' in source ? source.uri : source.path;
  // Which note the player holds. A different note (Record again) starts over.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const current = (status.currentTime ?? 0) * 1000;
  const total = (status.duration ?? 0) * 1000;
  const finished = status.didJustFinish || (total > 0 && current >= total - 50);
  const resumable = loadedKey === key && status.isLoaded && !finished;

  const toggle = async () => {
    setError(null);
    if (status.playing) {
      player.pause();
      return;
    }
    if (resumable) {
      player.play();
      return;
    }
    setLoading(true);
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      // Finished or new: from the top, with a fresh URL for a bucket object.
      const uri = 'uri' in source ? source.uri : await voicePlaybackUrl(source.path);
      player.replace({ uri });
      setLoadedKey(key);
      player.play();
      if (played) track('voice_played', played);
    } catch (e) {
      const appError = toAppError(e);
      setError(appError.kind === 'NETWORK' ? appError.message : t('voice.player.error'));
    } finally {
      setLoading(false);
    }
  };

  /** Milliseconds played (0 when another note or nothing is loaded), for the progress bars. */
  const positionMs = loadedKey === key && !finished ? Math.max(0, current) : 0;

  return { playing: !!status.playing, loading, error, positionMs, toggle };
}
