import { getRecentLittleThings } from '@/features/littleThings/api';
import { littleThingChannels, littleThingSoundFile } from '@/features/littleThings/channels';
import { hapticSteps, hasGestureSound, playGestureSound } from '@/features/littleThings/feedback';
import {
  createLittleThingsSeenStore,
  createLocalSoundOffStore,
} from '@/features/littleThings/hooks';
import {
  hugSeconds,
  RECEIVE_WINDOW_MS,
  receivedMoment,
  type ReceivedRow,
} from '@/features/littleThings/model';
import { memoryStorage } from '@/test/memoryStorage';

/** MOB-59 (24d): the received moment, the query, sounds, haptics, channels and local stores. */

type Query = Record<string, jest.Mock>;
const calls: [string, unknown[]][] = [];
let mockResult: { data: unknown; error: unknown } = { data: [], error: null };
jest.mock('@/lib/supabase', () => {
  const chain: Query = {};
  for (const m of ['select', 'eq', 'is', 'gte', 'order']) {
    chain[m] = jest.fn((...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    });
  }
  chain.limit = jest.fn((...args: unknown[]) => {
    calls.push(['limit', args]);
    return Promise.resolve(mockResult);
  });
  return {
    supabase: {
      from: (table: string) => {
        calls.push(['from', [table]]);
        return chain;
      },
    },
  };
});

const NOW = Date.parse('2026-11-11T21:04:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
let n = 0;
const row = (
  senderId: string,
  kind: ReceivedRow['kind'],
  min: number,
  extra: Partial<ReceivedRow> = {},
): ReceivedRow => ({
  id: `g${++n}`,
  senderId,
  kind,
  amount: 1,
  sameTime: false,
  createdAt: ago(min),
  ...extra,
});

beforeEach(() => {
  calls.length = 0;
  mockResult = { data: [], error: null };
});

describe('receivedMoment', () => {
  it('nothing new: null', () => {
    expect(receivedMoment([], 'u1', null, NOW)).toBeNull();
    expect(receivedMoment([row('u1', 'kiss', 1)], 'u1', null, NOW)).toBeNull();
  });

  it('only gestures after the last seen one and inside the receive window', () => {
    const rows = [row('u2', 'kiss', 5), row('u2', 'hug', 2)];
    expect(receivedMoment(rows, 'u1', ago(3), NOW)?.ids).toEqual([rows[1]!.id]);
    expect(receivedMoment(rows, 'u1', ago(1), NOW)).toBeNull();
    const old = row('u2', 'kiss', RECEIVE_WINDOW_MS / 60_000 + 1);
    expect(receivedMoment([old], 'u1', null, NOW)).toBeNull();
  });

  it('counts kisses per kiss and other kinds per send, first sent first; newest acted out', () => {
    const m = receivedMoment(
      [
        row('u2', 'hug', 1, { amount: 4000 }),
        row('u2', 'kiss', 3, { amount: 2 }),
        row('u2', 'kiss', 4, { amount: 3 }),
        row('u2', 'hug', 5),
      ],
      'u1',
      null,
      NOW,
    );
    expect(m?.counts).toEqual([
      { kind: 'hug', count: 2 },
      { kind: 'kiss', count: 5 },
    ]);
    expect(m?.kind).toBe('hug');
    expect(m?.amount).toBe(4000);
    expect(m?.newestAt).toBe(ago(1));
  });

  it('back: the same kind as mine within 10 minutes before it', () => {
    expect(
      receivedMoment([row('u1', 'kiss', 5), row('u2', 'kiss', 1)], 'u1', null, NOW)?.back,
    ).toBe(true);
    expect(
      receivedMoment([row('u1', 'kiss', 12), row('u2', 'kiss', 1)], 'u1', null, NOW)?.back,
    ).toBe(false);
    expect(receivedMoment([row('u1', 'hug', 2), row('u2', 'kiss', 1)], 'u1', null, NOW)?.back).toBe(
      false,
    );
    // Mine after theirs is not an answer from them.
    expect(
      receivedMoment([row('u2', 'kiss', 2), row('u1', 'kiss', 1)], 'u1', null, NOW)?.back,
    ).toBe(false);
  });

  it('same time only for a hug the server flagged', () => {
    expect(
      receivedMoment([row('u2', 'hug', 0, { sameTime: true })], 'u1', null, NOW)?.sameTime,
    ).toBe(true);
    expect(
      receivedMoment([row('u2', 'kiss', 0, { sameTime: true })], 'u1', null, NOW)?.sameTime,
    ).toBe(false);
  });

  it('hug seconds round, at least 1', () => {
    expect(hugSeconds(4200)).toBe(4);
    expect(hugSeconds(200)).toBe(1);
  });
});

describe('getRecentLittleThings (CONTRACTS §2 table read)', () => {
  it('reads the couple, skips undone sends, newest first within the window, no client id', async () => {
    mockResult = {
      data: [
        {
          id: 'g1',
          sender_id: 'u2',
          kind: 'kiss',
          amount: 3,
          same_time: false,
          created_at: ago(1),
        },
        {
          id: 'g2',
          sender_id: 'u2',
          kind: 'wave',
          amount: 1,
          same_time: false,
          created_at: ago(2),
        },
      ],
      error: null,
    };
    const rows = await getRecentLittleThings('couple-1', NOW);
    expect(rows).toEqual([
      { id: 'g1', senderId: 'u2', kind: 'kiss', amount: 3, sameTime: false, createdAt: ago(1) },
    ]);
    expect(calls).toEqual([
      ['from', ['little_things']],
      ['select', ['id, sender_id, kind, amount, same_time, created_at']],
      ['eq', ['couple_id', 'couple-1']],
      ['is', ['undone_at', null]],
      ['gte', ['created_at', new Date(NOW - RECEIVE_WINDOW_MS).toISOString()]],
      ['order', ['created_at', { ascending: false }]],
      ['limit', [30]],
    ]);
  });

  it('maps errors', async () => {
    mockResult = { data: null, error: { message: 'NOT_AUTHENTICATED', code: 'P0001' } };
    await expect(getRecentLittleThings('c', NOW)).rejects.toMatchObject({
      kind: 'NOT_AUTHENTICATED',
    });
  });
});

describe('feedback (LEAD-11 seam)', () => {
  it('no sounds bundled yet: playing is silent and never throws', () => {
    for (const kind of ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'] as const) {
      expect(hasGestureSound(kind)).toBe(false);
      expect(() => playGestureSound(kind)).not.toThrow();
    }
  });

  it('haptics per gesture', () => {
    expect(hapticSteps('kiss', 3)).toHaveLength(6);
    expect(hapticSteps('kiss', 9)).toHaveLength(10);
    expect(hapticSteps('goodnight', 1)).toHaveLength(1);
    expect(hapticSteps('good_morning', 1)).toHaveLength(3);
    expect(hapticSteps('miss_you', 1)).toHaveLength(4);
    const hug = hapticSteps('hug', 3000);
    expect(hug.length).toBe(25);
    expect(hapticSteps('hug', 60_000).length).toBe(Math.floor(5000 / 120));
  });
});

describe('Android channels (CONTRACTS §5)', () => {
  it('one per gesture plus quiet, default sound until the files are bundled', () => {
    const channels = littleThingChannels([]);
    expect(channels.map((c) => c.id)).toEqual([
      'little_thing_hug',
      'little_thing_kiss',
      'little_thing_goodnight',
      'little_thing_good_morning',
      'little_thing_miss_you',
      'little_thing_quiet',
    ]);
    expect(channels.filter((c) => !c.quiet).every((c) => c.sound === undefined)).toBe(true);
    expect(channels.find((c) => c.quiet)?.sound).toBeNull();
  });

  it('uses the bundled file once it exists', () => {
    expect(littleThingChannels(['kiss']).find((c) => c.id === 'little_thing_kiss')?.sound).toBe(
      'little_thing_kiss.wav',
    );
    expect(littleThingSoundFile('good_morning')).toBe('little_thing_good_morning.wav');
  });
});

describe('local stores', () => {
  it('seen: per person, never moves back, survives a restart', () => {
    const storage = memoryStorage();
    const a = createLittleThingsSeenStore(storage);
    a.getState().markSeen('u1', ago(2));
    a.getState().markSeen('u1', ago(5));
    expect(a.getState().seenAt('u1')).toBe(ago(2));
    expect(a.getState().seenAt('u9')).toBeNull();
    const b = createLittleThingsSeenStore(storage);
    expect(b.getState().seenAt('u1')).toBe(ago(2));
  });

  it('show marks the moment seen; dismiss only clears that moment', () => {
    const s = createLittleThingsSeenStore(memoryStorage());
    const m = receivedMoment([row('u2', 'kiss', 1)], 'u1', null, NOW)!;
    s.getState().show('u1', m);
    expect(s.getState().moment).toBe(m);
    expect(s.getState().seenAt('u1')).toBe(m.newestAt);
    s.getState().dismiss({ ...m });
    expect(s.getState().moment).toBe(m);
    s.getState().dismiss(m);
    expect(s.getState().moment).toBeNull();
  });

  it('local sound "off" (MOB-59) waits to be copied once, then the key is gone (MOB-67)', () => {
    const storage = memoryStorage();
    expect(createLocalSoundOffStore(storage).getState().pending).toBe(false);
    storage.setItem('sound', '1');
    expect(createLocalSoundOffStore(storage).getState().pending).toBe(false);
    expect(storage.getItem('sound')).toBeNull();
    storage.setItem('sound', '0');
    const store = createLocalSoundOffStore(storage);
    expect(store.getState().pending).toBe(true);
    expect(createLocalSoundOffStore(storage).getState().pending).toBe(true);
    store.getState().clear();
    expect(store.getState().pending).toBe(false);
    expect(storage.getItem('sound')).toBeNull();
    expect(createLocalSoundOffStore(storage).getState().pending).toBe(false);
  });
});
