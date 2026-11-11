// BE-43: removing voice recordings through the Storage API (used by voice-cleanup and
// delete-account). Direct SQL deletes on storage.objects would leave the files behind.
type RemoveResult = { error: unknown | null };
export type VoiceStorage = {
  storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<RemoveResult> } };
};

export const CHUNK = 100; // names per Storage remove call

// PostgREST returns a `setof text` function as an array of strings; accept the row-object shape
// (`{ voice_sweep: name }`) too, so a PostgREST change cannot turn into a silent no-op.
export const objectNames = (data: unknown): string[] =>
  (Array.isArray(data) ? data : []).map((row) =>
    typeof row === 'string'
      ? row
      : row && typeof row === 'object'
      ? Object.values(row as Record<string, unknown>).find((v) => typeof v === 'string')
      : undefined
  ).filter((name): name is string => typeof name === 'string' && name.length > 0);

// Removes `names` from the voice bucket in chunks. Returns false on the first failed chunk.
export const removeVoiceObjects = async (
  admin: VoiceStorage,
  names: string[],
): Promise<boolean> => {
  for (let i = 0; i < names.length; i += CHUNK) {
    const { error: removeError } = await admin.storage.from('voice').remove(
      names.slice(i, i + CHUNK),
    );
    if (removeError) return false;
  }
  return true;
};
