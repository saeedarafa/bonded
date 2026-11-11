import type { AppErrorKind } from '@/lib/errors';
import type { QueuedVoice } from '@/lib/outbox';

import { VOICE_ATTACH_TTL_MS, VOICE_NAME_TTL_MS } from './encoding';

/**
 * What a queued voice take needs before its row can be written (pure, for tests):
 * - `issue`: no name yet, or the name is older than ~1 h and nothing was uploaded, or the upload is
 *   older than ~23 h (the server would refuse to attach it): ask for a fresh name, then upload;
 * - `upload`: a fresh issued name, not uploaded yet (a retry within the hour: same name);
 * - `save`: uploaded recently: only the row.
 */
export function voiceUploadStep(voice: QueuedVoice, now: number): 'issue' | 'upload' | 'save' {
  const age = (at: string | undefined) => (at ? now - Date.parse(at) : Number.NaN);
  if (voice.path && voice.uploaded) {
    // An upload from before BE-43 has no time: try the row; INVALID_VOICE resets it.
    if (!voice.uploadedAt) return 'save';
    const uploadedAge = age(voice.uploadedAt);
    return uploadedAge >= 0 && uploadedAge < VOICE_ATTACH_TTL_MS ? 'save' : 'issue';
  }
  const issuedAge = age(voice.issuedAt);
  return voice.path && issuedAge >= 0 && issuedAge < VOICE_NAME_TTL_MS ? 'upload' : 'issue';
}

/** These say the take's name or upload is no good any more: the next try starts fresh. */
export const FRESH_UPLOAD_KINDS: readonly AppErrorKind[] = ['INVALID_VOICE', 'VOICE_DENIED'];
