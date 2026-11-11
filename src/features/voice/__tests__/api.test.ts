import { File } from 'expo-file-system';

import {
  deleteLocalTake,
  deleteVoiceObject,
  storageUploadError,
  uploadVoice,
  voiceObjectPath,
  voicePlaybackUrl,
} from '@/features/voice/api';
import {
  formatVoiceTime,
  VOICE_ANSWER_MAX_MS,
  VOICE_CONTENT_TYPE,
  VOICE_MAX_BYTES,
  VOICE_RECORDING,
  VOICE_URL_TTL_SECONDS,
} from '@/features/voice/encoding';

const mockUpload = jest.fn<Promise<unknown>, [string, unknown, Record<string, unknown>]>();
const mockSign = jest.fn<Promise<unknown>, [string, number]>();
const mockRemove = jest.fn<Promise<unknown>, [string[]]>();
const mockBucket = jest.fn<void, [string]>();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        mockBucket(bucket);
        return {
          upload: (path: string, body: unknown, options: Record<string, unknown>) =>
            mockUpload(path, body, options),
          createSignedUrl: (path: string, expiresIn: number) => mockSign(path, expiresIn),
          remove: (paths: string[]) => mockRemove(paths),
        };
      },
    },
  },
}));

/** A StorageApiError as storage-js builds it from the HTTP 400 body (CONTRACTS §2). */
const storageError = (statusCode: string, code: string) => ({
  name: 'StorageApiError',
  message: 'refused c1/u1/take.m4a',
  status: 400,
  statusCode,
  code,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('encoder settings (D46: mono, ~24 kbps AAC, on the phone)', () => {
  it('records mono AAC in .m4a at 24 kbps into the documents folder', () => {
    expect(VOICE_RECORDING).toMatchObject({
      extension: '.m4a',
      numberOfChannels: 1,
      bitRate: 24_000,
      directory: 'document',
      android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
      ios: { outputFormat: 'aac ' },
    });
    // 90 s at 24 kbps stays well under the 400 KB bucket cap, with room for the container.
    expect((VOICE_RECORDING.bitRate / 8) * (VOICE_ANSWER_MAX_MS / 1000)).toBeLessThan(
      VOICE_MAX_BYTES * 0.75,
    );
  });

  it('limits: 90 s, 400 KB, audio/mp4, signed URLs at most 60 s', () => {
    expect(VOICE_ANSWER_MAX_MS).toBe(90_000);
    expect(VOICE_MAX_BYTES).toBe(409_600);
    expect(VOICE_CONTENT_TYPE).toBe('audio/mp4');
    expect(VOICE_URL_TTL_SECONDS).toBeLessThanOrEqual(60);
  });

  it('formats times as m:ss', () => {
    expect(formatVoiceTime(0)).toBe('0:00');
    expect(formatVoiceTime(42_900)).toBe('0:42');
    expect(formatVoiceTime(90_000)).toBe('1:30');
  });
});

describe('voiceObjectPath', () => {
  it('is {couple_id}/{uid}/{uuid}.m4a in lower case', () => {
    expect(voiceObjectPath('C0FFEE-AA', 'U1-BB', 'ABC-123')).toBe('c0ffee-aa/u1-bb/abc-123.m4a');
  });
});

describe('uploadVoice', () => {
  it('uploads to bucket voice as audio/mp4 without overwriting', async () => {
    mockUpload.mockResolvedValue({ data: { path: 'c1/u1/t.m4a' }, error: null });
    await uploadVoice({ path: 'c1/u1/t.m4a', fileUri: 'file:///doc/t.m4a' });
    expect(mockBucket).toHaveBeenCalledWith('voice');
    expect(mockUpload).toHaveBeenCalledWith('c1/u1/t.m4a', expect.any(ArrayBuffer), {
      contentType: 'audio/mp4',
      upsert: false,
    });
  });

  it('refuses a take over 400 KB on the phone, before sending anything', async () => {
    jest.spyOn(File.prototype, 'size', 'get').mockReturnValue(VOICE_MAX_BYTES + 1);
    await expect(
      uploadVoice({ path: 'c1/u1/t.m4a', fileUri: 'file:///doc/t.m4a' }),
    ).rejects.toMatchObject({ kind: 'VOICE_TOO_LARGE' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('a take already in the bucket (a retry) counts as uploaded', async () => {
    mockUpload.mockResolvedValue({ data: null, error: storageError('409', 'Duplicate') });
    await expect(
      uploadVoice({ path: 'c1/u1/t.m4a', fileUri: 'file:///doc/t.m4a' }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['403', 'AccessDenied', 'VOICE_DENIED'],
    ['413', 'EntityTooLarge', 'VOICE_TOO_LARGE'],
    ['415', 'InvalidMimeType', 'VOICE_FORMAT'],
  ])('maps Storage %s %s to %s without the object name', async (status, code, kind) => {
    mockUpload.mockResolvedValue({ data: null, error: storageError(status, code) });
    const error = await uploadVoice({ path: 'c1/u1/t.m4a', fileUri: 'file:///doc/t.m4a' }).catch(
      (e: Error) => e,
    );
    expect(error).toMatchObject({ kind });
    expect((error as Error).message).not.toContain('c1/u1');
  });

  it('a dropped connection is NETWORK (the queue tries again)', async () => {
    mockUpload.mockResolvedValue({
      data: null,
      error: { name: 'StorageUnknownError', message: 'Network request failed' },
    });
    await expect(
      uploadVoice({ path: 'c1/u1/t.m4a', fileUri: 'file:///doc/t.m4a' }),
    ).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  it('storageUploadError knows the codes by statusCode alone too', () => {
    expect(storageUploadError({ statusCode: '403' })?.kind).toBe('VOICE_DENIED');
    expect(storageUploadError({ statusCode: '409' })).toBeNull();
  });
});

describe('voicePlaybackUrl (SEC-09)', () => {
  it('signs for 60 s at most and returns the URL only to the caller', async () => {
    mockSign.mockResolvedValue({
      data: { signedUrl: 'https://x/sign/voice/a?token=t' },
      error: null,
    });
    await expect(voicePlaybackUrl('c1/u2/a.m4a')).resolves.toBe('https://x/sign/voice/a?token=t');
    expect(mockSign).toHaveBeenCalledWith('c1/u2/a.m4a', 60);
  });

  it('a locked or missing object (reveal rule) is an error, never a URL', async () => {
    mockSign.mockResolvedValue({ data: null, error: storageError('400', 'not_found') });
    await expect(voicePlaybackUrl('c1/u2/a.m4a')).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });
});

describe('cleanup', () => {
  it('deleteVoiceObject never throws', async () => {
    mockRemove.mockRejectedValue(new Error('offline'));
    await expect(deleteVoiceObject('c1/u1/t.m4a')).resolves.toBeUndefined();
  });

  it('deleteLocalTake deletes the file and ignores a missing one', () => {
    const del = jest.spyOn(File.prototype, 'delete');
    deleteLocalTake('file:///doc/t.m4a');
    expect(del).toHaveBeenCalledTimes(1);
    deleteLocalTake(null);
    expect(del).toHaveBeenCalledTimes(1);
  });
});
