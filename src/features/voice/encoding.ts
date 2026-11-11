import { AudioQuality, IOSOutputFormat, type RecordingOptions } from 'expo-audio';

/**
 * D46 voice answer limits and the recorder settings (MOB-55). The phone does all the compression:
 * the server never re-encodes, and the bucket refuses anything over 400 KB or of another type
 * (CONTRACTS §2 *Voice upload*, SEC-09).
 */

/** A voice answer is at most 90 seconds (D46). Recording stops by itself there. */
export const VOICE_ANSWER_MAX_MS = 90_000;

/** Bucket `voice` object limit (BE-42 `file_size_limit` 409600 bytes). */
export const VOICE_MAX_BYTES = 400 * 1024;

/** `.m4a` (AAC in MPEG-4) is sent as `audio/mp4`; supabase-js's default `text/plain` is refused. */
export const VOICE_CONTENT_TYPE = 'audio/mp4';
export const VOICE_EXTENSION = 'm4a';

/**
 * BE-43: an upload name from `start_voice_upload` is good for 1 hour (caller only), and an uploaded
 * recording must be attached to a row within 23 hours. The app renews a little earlier, so a slow
 * upload or a small clock difference never lands on the server's edge.
 */
export const VOICE_NAME_TTL_MS = 50 * 60 * 1000;
export const VOICE_ATTACH_TTL_MS = 22 * 60 * 60 * 1000;

/** Signed playback URLs live at most 60 seconds (SEC-09) and are made only when playback starts. */
export const VOICE_URL_TTL_SECONDS = 60;

/**
 * Mono AAC at about 24 kbps in an MPEG-4 container: ~180 KB a minute, ~270 KB for 90 s, well under
 * the 400 KB cap. 22.05 kHz is plenty for speech and keeps the AAC encoder efficient at this rate.
 * Files go to the app's documents folder (not the cache) so a take queued offline survives until
 * it is sent; the app deletes it after sending or discarding.
 */
export const VOICE_RECORDING: RecordingOptions = {
  extension: `.${VOICE_EXTENSION}`,
  sampleRate: 22_050,
  numberOfChannels: 1,
  bitRate: 24_000,
  directory: 'document',
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    maxFileSize: VOICE_MAX_BYTES,
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
  },
  web: { mimeType: 'audio/mp4', bitsPerSecond: 24_000 },
};

/** "0:42", "1:30" (minutes:seconds, rounded down). */
export function formatVoiceTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
