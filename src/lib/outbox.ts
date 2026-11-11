import { create } from 'zustand';

import type { AppErrorKind } from '@/lib/errors';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * The offline queue (MOB-12 thread outbox, MOB-14 answers), kept in the encrypted MMKV store
 * (src/lib/storage.ts) so it survives an app restart. Wiped on sign-out.
 *
 * - Thread messages this device is sending, keyed by `client_id`. A failed message keeps its
 *   `client_id`, also across a restart, so "Retry" resends the SAME id: a duplicate is impossible
 *   (CONTRACTS §2, a unique violation then means it already arrived). A voice message (MOB-56)
 *   also keeps its take's file and issued bucket name until it is sent.
 * - Answers locked in while offline, keyed by `couple_question_id` (the answer upsert is one row
 *   per person per question, so queueing again replaces, never duplicates). Each keeps the device
 *   time it was written (`client_written_at`, D17); the server clamps it to arrival time.
 *
 * A queued answer exists only on this phone: it never counts as "answered" for the reveal rule.
 * Only the server (RLS, after sync) opens the partner's answer.
 *
 * Text here is never logged, tracked or put in a query key. Storage failures are swallowed: the
 * in-memory queue still works and the worst case is losing the queue on a restart.
 */
export type OutboxStatus = 'sending' | 'failed' | 'sent';

export type OutboxItem = {
  clientId: string;
  coupleQuestionId: string;
  /** The text; empty for a voice message. */
  body: string;
  /**
   * Set for a voice message (D46, MOB-56): the take on the phone and, once issued, its bucket name.
   * A retry keeps the `client_id` and reuses a fresh name or upload (same rules as answers).
   */
  voice?: QueuedVoice;
  /** Device time, only to order my pending messages after the server's. */
  createdAt: string;
  status: OutboxStatus;
};

/**
 * A voice answer waiting to send (D46, MOB-55, BE-43): the take stays in the app's documents folder
 * until it is saved. The bucket name is issued by the server (`start_voice_upload`) right before the
 * first upload and kept here, so a retry within the hour uploads to the same name (an object that
 * already arrived is not sent again); `uploaded` skips the upload after a failed answer write.
 * Times are device ISO times, only to know when a name (1 h) or an upload (23 h) is too old.
 */
export type QueuedVoice = {
  durationMs: number;
  fileUri: string;
  /** The issued object name; absent until the queue asks for one. */
  path?: string;
  /** When `path` was issued. */
  issuedAt?: string;
  uploaded?: boolean;
  /** When the upload finished. */
  uploadedAt?: string;
};

/** queued = waiting for the connection; failed = the server said no (a definite error). */
export type QueuedAnswerStatus = 'queued' | 'sending' | 'failed';

export type QueuedAnswer = {
  coupleQuestionId: string;
  userId: string;
  /** The text; empty for a voice answer. */
  body: string;
  /** Set for a voice answer (text XOR voice). */
  voice?: QueuedVoice;
  /** ISO device time the answer was locked in (D17). */
  clientWrittenAt: string;
  status: QueuedAnswerStatus;
  /** The error kind when `failed` (never the server's text). */
  errorKind?: AppErrorKind;
  /** ANSWER_TOO_LONG: the limit the server applied (a number only). */
  errorMax?: number;
};

export type OutboxState = {
  items: Record<string, OutboxItem>;
  answers: Record<string, QueuedAnswer>;
  put: (item: OutboxItem) => void;
  setStatus: (clientId: string, status: OutboxStatus) => void;
  remove: (clientIds: string[]) => void;
  /** Voice message: an issued upload name (BE-43); clears any earlier upload. */
  setMessageVoicePath: (clientId: string, path: string, issuedAt: string) => void;
  /** Voice message: the take is in the bucket, a retry only inserts the row. */
  markMessageVoiceUploaded: (clientId: string, uploadedAt: string) => void;
  /** Voice message: forget the name and the upload (next try starts fresh). */
  resetMessageVoiceUpload: (clientId: string) => void;
  queueAnswer: (answer: Omit<QueuedAnswer, 'status' | 'errorKind' | 'errorMax'>) => void;
  setAnswerStatus: (
    coupleQuestionId: string,
    status: QueuedAnswerStatus,
    errorKind?: AppErrorKind,
    errorMax?: number,
  ) => void;
  /** An issued upload name for the queued take (BE-43); clears any earlier upload. */
  setVoicePath: (coupleQuestionId: string, path: string, issuedAt: string) => void;
  /** The voice take of a queued answer is in the bucket: a retry only writes the row. */
  markVoiceUploaded: (coupleQuestionId: string, uploadedAt: string) => void;
  /** Forget the name and the upload: the next try asks for a fresh name and uploads again. */
  resetVoiceUpload: (coupleQuestionId: string) => void;
  removeAnswer: (coupleQuestionId: string) => void;
  /** Sign-out: forget everything, in memory and on disk. */
  reset: () => void;
};

const MESSAGES_KEY = 'messages';
const ANSWERS_KEY = 'answers';
/** Bounds, so a long offline stretch can't grow the store forever. */
const MAX_MESSAGES = 50;
const MAX_ANSWERS = 5;

function read<T>(storage: KeyValueStorage, key: string): Record<string, T> {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function write(storage: KeyValueStorage, key: string, value: Record<string, unknown>): void {
  try {
    if (Object.keys(value).length) storage.setItem(key, JSON.stringify(value));
    else storage.removeItem(key);
  } catch {
    // Storage unavailable: keep the in-memory queue.
  }
}

/** Keeps the newest `max` entries by a time field. */
function newest<T>(record: Record<string, T>, max: number, time: (v: T) => string) {
  const entries = Object.entries(record);
  if (entries.length <= max) return record;
  entries.sort(([, a], [, b]) => time(a).localeCompare(time(b)));
  return Object.fromEntries(entries.slice(entries.length - max));
}

/**
 * After a restart nothing is in flight: a message that was sending is "Not sent" (retry keeps its
 * id), an answer that was sending is queued again. A sent message is on the server already.
 */
function restore(storage: KeyValueStorage) {
  const items: Record<string, OutboxItem> = {};
  for (const [id, item] of Object.entries(read<OutboxItem>(storage, MESSAGES_KEY))) {
    if (item.status !== 'sent') items[id] = { ...item, status: 'failed' };
  }
  const answers: Record<string, QueuedAnswer> = {};
  for (const [id, answer] of Object.entries(read<QueuedAnswer>(storage, ANSWERS_KEY))) {
    answers[id] = answer.status === 'sending' ? { ...answer, status: 'queued' } : answer;
  }
  return { items, answers };
}

export function createOutboxStore(storage: KeyValueStorage) {
  const store = create<OutboxState>()((set) => ({
    ...restore(storage),
    put: (item) =>
      set((s) => ({
        items: newest({ ...s.items, [item.clientId]: item }, MAX_MESSAGES, (m) => m.createdAt),
      })),
    setStatus: (clientId, status) =>
      set((s) => {
        const item = s.items[clientId];
        return item ? { items: { ...s.items, [clientId]: { ...item, status } } } : s;
      }),
    remove: (clientIds) =>
      set((s) => {
        const items = { ...s.items };
        for (const id of clientIds) delete items[id];
        return { items };
      }),
    setMessageVoicePath: (clientId, path, issuedAt) =>
      set((s) => {
        const item = s.items[clientId];
        if (!item?.voice) return s;
        const { durationMs, fileUri } = item.voice;
        const voice = { durationMs, fileUri, path, issuedAt };
        return { items: { ...s.items, [clientId]: { ...item, voice } } };
      }),
    markMessageVoiceUploaded: (clientId, uploadedAt) =>
      set((s) => {
        const item = s.items[clientId];
        if (!item?.voice?.path || item.voice.uploaded) return s;
        const voice = { ...item.voice, uploaded: true, uploadedAt };
        return { items: { ...s.items, [clientId]: { ...item, voice } } };
      }),
    resetMessageVoiceUpload: (clientId) =>
      set((s) => {
        const item = s.items[clientId];
        if (!item?.voice?.path) return s;
        const { durationMs, fileUri } = item.voice;
        return { items: { ...s.items, [clientId]: { ...item, voice: { durationMs, fileUri } } } };
      }),
    queueAnswer: (answer) =>
      set((s) => ({
        answers: newest(
          { ...s.answers, [answer.coupleQuestionId]: { ...answer, status: 'queued' } },
          MAX_ANSWERS,
          (a) => a.clientWrittenAt,
        ),
      })),
    setAnswerStatus: (id, status, errorKind, errorMax) =>
      set((s) => {
        const answer = s.answers[id];
        if (!answer) return s;
        const next: QueuedAnswer = { ...answer, status };
        if (errorKind) next.errorKind = errorKind;
        else delete next.errorKind;
        if (errorKind && errorMax !== undefined) next.errorMax = errorMax;
        else delete next.errorMax;
        return { answers: { ...s.answers, [id]: next } };
      }),
    setVoicePath: (id, path, issuedAt) =>
      set((s) => {
        const answer = s.answers[id];
        if (!answer?.voice) return s;
        const { durationMs, fileUri } = answer.voice;
        return {
          answers: {
            ...s.answers,
            [id]: { ...answer, voice: { durationMs, fileUri, path, issuedAt } },
          },
        };
      }),
    markVoiceUploaded: (id, uploadedAt) =>
      set((s) => {
        const answer = s.answers[id];
        if (!answer?.voice?.path || answer.voice.uploaded) return s;
        return {
          answers: {
            ...s.answers,
            [id]: { ...answer, voice: { ...answer.voice, uploaded: true, uploadedAt } },
          },
        };
      }),
    resetVoiceUpload: (id) =>
      set((s) => {
        const answer = s.answers[id];
        if (!answer?.voice?.path) return s;
        const { durationMs, fileUri } = answer.voice;
        return { answers: { ...s.answers, [id]: { ...answer, voice: { durationMs, fileUri } } } };
      }),
    removeAnswer: (id) =>
      set((s) => {
        if (!s.answers[id]) return s;
        const answers = { ...s.answers };
        delete answers[id];
        return { answers };
      }),
    reset: () => set({ items: {}, answers: {} }),
  }));
  // Every change goes to disk (only the part that changed).
  store.subscribe((state, previous) => {
    if (state.items !== previous.items) write(storage, MESSAGES_KEY, state.items);
    if (state.answers !== previous.answers) write(storage, ANSWERS_KEY, state.answers);
  });
  return store;
}

export const useOutbox = createOutboxStore(createKeyValueStorage('outbox:'));

/** Called from the SIGNED_OUT handler (DataProvider). */
export function clearOutbox(): void {
  useOutbox.getState().reset();
}
