import { File } from 'expo-file-system';

import { AppError, messageFor, toAppError, unwrap, type VoiceUploadKind } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import {
  VOICE_CONTENT_TYPE,
  VOICE_EXTENSION,
  VOICE_MAX_BYTES,
  VOICE_URL_TTL_SECONDS,
} from './encoding';

/**
 * Voice files in the private bucket `voice` (BE-42, CONTRACTS §2 *Voice upload*, SEC-09).
 *
 * Privacy: object names, signed URLs and audio never go to logs, analytics, Sentry or a cache.
 * Errors are turned into AppErrors here (kind + translated text only), so the Storage message,
 * which can name the object, never travels further.
 */
const BUCKET = 'voice';

/**
 * BE-43: asks the server for the name of the next upload (`{couple_id}/{uid}/{uuid}.m4a`). One
 * slot per take, valid 1 hour for me only; a name the app makes up itself is refused by Storage.
 * Throws `VOICE_LIMIT` (the couple's 20 a day), `PREMIUM_REQUIRED`, `NOT_PAIRED` before anything
 * is uploaded.
 */
export async function startVoiceUpload(): Promise<string> {
  const name = unwrap(await supabase.rpc('start_voice_upload', { p_ext: VOICE_EXTENSION }));
  if (typeof name !== 'string' || !name) throw toAppError(new Error('no name'));
  return name;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function fail(kind: VoiceUploadKind): AppError {
  return new AppError(kind, messageFor(kind));
}

/**
 * A Storage refusal (HTTP 400 with the real status in the body) to an app error. `null` means
 * "already uploaded": a retry after an upload whose answer write failed finds its own object.
 * `AccessDenied` also covers an issued name older than an hour (BE-43).
 */
export function storageUploadError(error: unknown): AppError | null {
  const statusCode = String(field(error, 'statusCode') ?? '');
  const code = String(field(error, 'code') ?? '');
  if (code === 'Duplicate' || code === 'ResourceAlreadyExists' || statusCode === '409') return null;
  if (code === 'EntityTooLarge' || statusCode === '413') return fail('VOICE_TOO_LARGE');
  if (code === 'InvalidMimeType' || statusCode === '415') return fail('VOICE_FORMAT');
  if (code === 'AccessDenied' || statusCode === '403') return fail('VOICE_DENIED');
  return toAppError(error);
}

/**
 * Uploads a recorded take (`upsert: false`: never overwrites). Checks the size on the phone first,
 * so an oversized take fails at once instead of after sending 400 KB.
 */
export async function uploadVoice(input: { path: string; fileUri: string }): Promise<void> {
  const file = new File(input.fileUri);
  if (!file.exists) throw fail('VOICE_FORMAT');
  if ((file.size ?? 0) > VOICE_MAX_BYTES) throw fail('VOICE_TOO_LARGE');
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw fail('VOICE_FORMAT');
  }
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(input.path, bytes, { contentType: VOICE_CONTENT_TYPE, upsert: false });
  if (!error) return;
  const appError = storageUploadError(error);
  if (appError) throw appError;
}

/**
 * A playback URL valid for at most 60 seconds. Call it when playback starts and hand the result
 * straight to the player: never keep it in state, a query cache, storage or a log.
 */
export async function voicePlaybackUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, VOICE_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw toAppError(error ?? new Error('no url'));
  return data.signedUrl;
}

/**
 * Removes my unattached take from the bucket (a discarded or replaced recording). Storage only lets
 * the owner delete objects no row references, so this is best effort and never throws.
 */
export async function deleteVoiceObject(path: string): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // Unreferenced takes are cleaned up by the server later (BE-43).
  }
}

/** Deletes a take from the phone. Never throws. */
export function deleteLocalTake(fileUri: string | null | undefined): void {
  if (!fileUri) return;
  try {
    const file = new File(fileUri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}
