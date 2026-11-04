import {
  dehydrate,
  onlineManager,
  QueryClientProvider,
  type QueryClient,
} from '@tanstack/react-query';
import { persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { invitePreview } from '@/features/pairing/api';
import { useInvitePreview, useLinkPreview } from '@/features/pairing/hooks';
import { createMmkvPersister } from '@/lib/persister';
import { CACHE_BUSTER, createQueryClient, PERSIST_DEHYDRATE_OPTIONS } from '@/lib/queryClient';
import { memoryStorage } from '@/test/memoryStorage';

jest.mock('@/features/pairing/api', () => ({ invitePreview: jest.fn() }));

// A dummy link token (never a real credential).
const TOKEN = 'fixturetokenAAAABBBBCCCCDDDDEEEE';
const SIGNED = 'https://dev.supabase.co/storage/v1/object/sign/avatars/u1/a.jpg?token=signedXYZ';
const MAYA = {
  inviterName: 'Maya',
  inviterAvatarUrl: SIGNED,
  inviterAnsweredToday: false,
  expiresAt: '2999-01-01T00:00:00Z',
};
const preview = jest.mocked(invitePreview);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** What the app's persister would write right now (same options as DataProvider). */
async function persisted(): Promise<string> {
  const storage = memoryStorage();
  const persister = createMmkvPersister(storage, 0);
  await persistQueryClientSave({
    queryClient: client,
    persister,
    buster: CACHE_BUSTER,
    dehydrateOptions: PERSIST_DEHYDRATE_OPTIONS,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  return storage.getItem('query-cache') ?? '';
}

describe('invite tokens never reach the persisted cache (#79 security review, MOB-40)', () => {
  beforeEach(() => {
    client = createQueryClient();
    preview.mockReset();
    usePendingInvite.getState().clear();
    onlineManager.setOnline(false);
  });
  afterEach(() => {
    onlineManager.setOnline(true);
    client.clear();
  });

  it('J3 offline: a token preview is not paused (so not queued) and is never persisted', async () => {
    preview.mockRejectedValue(new Error('Network request failed'));
    const { result } = await renderHook(() => useInvitePreview(), { wrapper });
    await act(async () => {
      result.current.mutate({ code: '4827', token: TOKEN });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(preview).toHaveBeenCalledWith('4827', TOKEN);
    // While still mounted (the mutation is observed) and after a "restart" save.
    expect(JSON.stringify(dehydrate(client, PERSIST_DEHYDRATE_OPTIONS))).not.toContain(TOKEN);
    const stored = await persisted();
    expect(stored).toContain(CACHE_BUSTER);
    expect(stored).not.toContain(TOKEN);
  });

  it('J2 offline and online: neither the token nor the signed URL is persisted', async () => {
    preview.mockResolvedValue(MAYA);
    usePendingInvite.getState().set({ code: '4827', token: TOKEN });
    const { result, unmount } = await renderHook(() => useLinkPreview('4827', TOKEN), { wrapper });
    await waitFor(() => expect(result.current.data?.inviterAvatarUrl).toBe(SIGNED));
    // The first name goes to the in-memory invite for J4/J5; the signed URL does not.
    expect(usePendingInvite.getState().inviterName).toBe('Maya');
    expect(JSON.stringify(usePendingInvite.getState())).not.toContain(SIGNED);
    let stored = await persisted();
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(SIGNED);
    unmount();
    stored = await persisted();
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(SIGNED);
  });

  it('even a paused mutation carrying a token stays out of the persisted cache', async () => {
    // The old J3 shape: default network mode, so it pauses offline with the token in variables.
    const mutation = client.getMutationCache().build(client, {
      mutationFn: (vars: { token: string }) => Promise.resolve(vars),
      gcTime: 0,
    });
    void mutation.execute({ token: TOKEN }).catch(() => undefined);
    await waitFor(() => expect(mutation.state.isPaused).toBe(true));
    // Default dehydration would include it: that is the leak the persist options close.
    expect(JSON.stringify(dehydrate(client))).toContain(TOKEN);
    expect(JSON.stringify(dehydrate(client, PERSIST_DEHYDRATE_OPTIONS))).not.toContain(TOKEN);
    expect(await persisted()).not.toContain(TOKEN);
  });
});
