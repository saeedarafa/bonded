import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { KeyValueStorage } from '@/lib/storage';

import {
  createOnboardingSyncStore,
  CURRENT_QUESTIONNAIRE_VERSION,
  flushOnboardingAnswers,
  onboardingAnswerRows,
  queueOnboardingAnswers,
  useOnboardingAnswerSync,
  useOnboardingSync,
  type OnboardingAnswers,
} from '../answerSync';
import type { OnboardingAnswerRow } from '../api';

const mockUpsert = jest.fn<Promise<void>, [OnboardingAnswerRow[]]>();
jest.mock('@/features/onboarding/api', () => ({
  upsertOnboardingAnswers: (rows: OnboardingAnswerRow[]) => mockUpsert(rows),
}));

const T03 = '2026-11-11T08:00:00.000Z';
const T05 = '2026-11-11T08:01:00.000Z';
const T06 = '2026-11-11T08:02:00.000Z';
const ANSWERS: OnboardingAnswers = {
  lastLearned: 'this_month',
  stage: 'long_distance',
  goals: ['deep_talks', 'romance'],
  answeredAt: { last_learned: T03, stage: T05, goals: T06 },
};
const EXPECTED_ROWS: OnboardingAnswerRow[] = [
  {
    user_id: 'u1',
    question_id: 'last_learned',
    questionnaire_version: 1,
    answer: 'this_month',
    answered_at: T03,
  },
  {
    user_id: 'u1',
    question_id: 'stage',
    questionnaire_version: 1,
    answer: 'long_distance',
    answered_at: T05,
  },
  {
    user_id: 'u1',
    question_id: 'goals',
    questionnaire_version: 1,
    answer: ['deep_talks', 'romance'],
    answered_at: T06,
  },
];

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const pendingFor = (userId: string) =>
  Object.values(useOnboardingSync.getState().pending).filter((r) => r.userId === userId);

beforeEach(() => {
  mockUpsert.mockReset();
  mockUpsert.mockResolvedValue(undefined);
  useOnboardingSync.getState().reset();
  onlineManager.setOnline(true);
});
afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

describe('onboardingAnswerRows (D38)', () => {
  it('maps 03/05/06 to stable question ids and choice keys, with the version as a parameter', () => {
    const v1 = onboardingAnswerRows('u1', ANSWERS);
    expect(CURRENT_QUESTIONNAIRE_VERSION).toBe(1);
    expect(v1.map((r) => [r.questionId, r.questionnaireVersion, r.answer, r.answeredAt])).toEqual([
      ['last_learned', 1, 'this_month', T03],
      ['stage', 1, 'long_distance', T05],
      ['goals', 1, ['deep_talks', 'romance'], T06],
    ]);
    expect(onboardingAnswerRows('u1', ANSWERS, 2).every((r) => r.questionnaireVersion === 2)).toBe(
      true,
    );
  });

  it('sends only what was answered; goals cleared again are an answer ([])', () => {
    const rows = onboardingAnswerRows('u1', {
      lastLearned: null,
      stage: 'dating',
      goals: [],
      answeredAt: { stage: T05, goals: T06 },
    });
    expect(rows.map((r) => [r.questionId, r.answer])).toEqual([
      ['stage', 'dating'],
      ['goals', []],
    ]);
    expect(
      onboardingAnswerRows('u1', { lastLearned: null, stage: null, goals: [], answeredAt: {} }),
    ).toEqual([]);
  });
});

describe('flushOnboardingAnswers (MOB-37)', () => {
  it('writes the answers once after sign-in and does not re-send them after success', async () => {
    queueOnboardingAnswers('u1', ANSWERS);
    await expect(flushOnboardingAnswers('u1')).resolves.toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(EXPECTED_ROWS);
    expect(pendingFor('u1')).toEqual([]);

    await expect(flushOnboardingAnswers('u1')).resolves.toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('keeps the answers on the phone after a failure and retries the very same rows', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('network'));
    queueOnboardingAnswers('u1', ANSWERS);
    await expect(flushOnboardingAnswers('u1')).resolves.toBe(false);
    expect(pendingFor('u1')).toHaveLength(3);

    await expect(flushOnboardingAnswers('u1')).resolves.toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.calls[1]?.[0]).toEqual(mockUpsert.mock.calls[0]?.[0]);
    expect(pendingFor('u1')).toEqual([]);
  });

  it('sends nothing offline and keeps the answers', async () => {
    onlineManager.setOnline(false);
    queueOnboardingAnswers('u1', ANSWERS);
    await expect(flushOnboardingAnswers('u1')).resolves.toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(pendingFor('u1')).toHaveLength(3);
  });

  it('queueing again replaces (no duplicate rows), and parallel flushes make one request', async () => {
    queueOnboardingAnswers('u1', ANSWERS);
    queueOnboardingAnswers('u1', ANSWERS);
    expect(pendingFor('u1')).toHaveLength(3);
    await Promise.all([flushOnboardingAnswers('u1'), flushOnboardingAnswers('u1')]);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('a newer version sits next to the older one instead of replacing it', async () => {
    queueOnboardingAnswers('u1', ANSWERS, 1);
    queueOnboardingAnswers('u1', { ...ANSWERS, stage: 'dating' }, 2);
    expect(pendingFor('u1')).toHaveLength(6);
    await flushOnboardingAnswers('u1');
    const sent = mockUpsert.mock.calls[0]?.[0] ?? [];
    expect(
      sent.filter((r) => r.question_id === 'stage').map((r) => r.questionnaire_version),
    ).toEqual([1, 2]);
  });

  it("only sends the signed-in user's rows", async () => {
    queueOnboardingAnswers('u1', ANSWERS);
    queueOnboardingAnswers('u2', ANSWERS);
    await flushOnboardingAnswers('u1');
    expect(mockUpsert.mock.calls[0]?.[0].every((r) => r.user_id === 'u1')).toBe(true);
    expect(pendingFor('u2')).toHaveLength(3);
  });

  it('an answer changed while the write is in flight is kept and sent next', async () => {
    let release!: () => void;
    mockUpsert.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    queueOnboardingAnswers('u1', ANSWERS);
    const first = flushOnboardingAnswers('u1');
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    queueOnboardingAnswers('u1', {
      ...ANSWERS,
      stage: 'dating',
      answeredAt: { ...ANSWERS.answeredAt, stage: '2026-11-11T09:00:00.000Z' },
    });
    void flushOnboardingAnswers('u1');
    release();
    await expect(first).resolves.toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.calls[1]?.[0].find((r) => r.question_id === 'stage')?.answer).toBe(
      'dating',
    );
    expect(pendingFor('u1')).toEqual([]);
  });

  it('never logs the answers when the write fails', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    mockUpsert.mockRejectedValueOnce(new Error('long_distance this_month deep_talks'));
    queueOnboardingAnswers('u1', ANSWERS);
    await flushOnboardingAnswers('u1');
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('persisted queue', () => {
  it('survives an app restart until the write succeeds, then is gone from disk', () => {
    const storage = memoryStorage();
    const store = createOnboardingSyncStore(storage);
    store.getState().queue(onboardingAnswerRows('u1', ANSWERS));
    const restarted = createOnboardingSyncStore(storage);
    const rows = Object.values(restarted.getState().pending);
    expect(rows).toHaveLength(3);
    restarted.getState().settle(rows);
    expect(storage.data.size).toBe(0);
    expect(Object.keys(createOnboardingSyncStore(storage).getState().pending)).toEqual([]);
  });
});

describe('useOnboardingAnswerSync', () => {
  it('sends pending answers at launch (a retry after an earlier failure)', async () => {
    queueOnboardingAnswers('u1', ANSWERS);
    await renderHook(() => useOnboardingAnswerSync('u1'));
    await waitFor(() => expect(pendingFor('u1')).toEqual([]));
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('retries when the connection returns and when the app comes back, then stops', async () => {
    onlineManager.setOnline(false);
    await renderHook(() => useOnboardingAnswerSync('u1'));
    queueOnboardingAnswers('u1', ANSWERS);
    expect(mockUpsert).not.toHaveBeenCalled();

    mockUpsert.mockRejectedValueOnce(new Error('timeout'));
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    expect(pendingFor('u1')).toHaveLength(3);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(pendingFor('u1')).toEqual([]));
    expect(mockUpsert).toHaveBeenCalledTimes(2);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it('sends answers queued while signed in, and does nothing signed out', async () => {
    const { rerender } = await renderHook(
      ({ id }: { id: string | null }) => useOnboardingAnswerSync(id),
      {
        initialProps: { id: null as string | null },
      },
    );
    queueOnboardingAnswers('u1', ANSWERS);
    await act(async () => undefined);
    expect(mockUpsert).not.toHaveBeenCalled();
    await rerender({ id: 'u1' });
    await waitFor(() => expect(pendingFor('u1')).toEqual([]));
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
