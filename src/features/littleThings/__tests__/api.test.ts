import {
  getLittleThingsToday,
  LittleThingLimitError,
  sendLittleThing,
  undoLittleThing,
} from '@/features/littleThings/api';
import {
  fanOffsets,
  fanOrder,
  limitDetailsFrom,
  NOTHING_SENT,
  sendAmount,
  timeOfDayKind,
  toToday,
} from '@/features/littleThings/model';
import type { AppError } from '@/lib/errors';

const mockRpc = jest.fn<Promise<{ data: unknown; error: unknown }>, [string, unknown?]>();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (name: string, args?: unknown) => mockRpc(name, args) },
}));

beforeEach(() => jest.clearAllMocks());

const rows = [
  { kind: 'hug', at_limit: false, more_with_premium: true },
  { kind: 'kiss', at_limit: true, more_with_premium: true },
  { kind: 'goodnight', at_limit: true, more_with_premium: false },
  { kind: 'good_morning', at_limit: false, more_with_premium: false },
  { kind: 'miss_you', at_limit: false, more_with_premium: true },
];

describe('little things api (CONTRACTS §2, BE-44)', () => {
  it('send_little_thing passes kind, amount and the client id', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 'lt-1', same_time: true, at_limit: false },
      error: null,
    });
    await expect(sendLittleThing({ kind: 'kiss', amount: 3, clientId: 'c-1' })).resolves.toEqual({
      id: 'lt-1',
      sameTime: true,
      atLimit: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('send_little_thing', {
      p_kind: 'kiss',
      p_amount: 3,
      p_client_id: 'c-1',
    });
  });

  it('LITTLE_THING_LIMIT carries the kind and whether Premium allows more', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'LITTLE_THING_LIMIT',
        code: 'P0001',
        details: '{"kind":"kiss","more_with_premium":true}',
      },
    });
    const e = await sendLittleThing({ kind: 'kiss', amount: 3, clientId: 'c' }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(LittleThingLimitError);
    expect(e).toMatchObject({ kind: 'LITTLE_THING_LIMIT', limitKind: 'kiss', morePremium: true });
    expect((e as AppError).message).toBe("That's all for today. You can send more tomorrow.");
  });

  it('other codes map as usual (INVALID_LITTLE_THING, UNDO_EXPIRED)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'INVALID_LITTLE_THING' } });
    await expect(sendLittleThing({ kind: 'hug', amount: 1, clientId: 'c' })).rejects.toMatchObject({
      kind: 'INVALID_LITTLE_THING',
    });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'UNDO_EXPIRED' } });
    await expect(undoLittleThing('lt-1')).rejects.toMatchObject({ kind: 'UNDO_EXPIRED' });
  });

  it('undo and today return the five states (no counts)', async () => {
    mockRpc.mockResolvedValue({ data: rows, error: null });
    const today = await getLittleThingsToday();
    expect(mockRpc).toHaveBeenCalledWith('little_things_today', undefined);
    expect(today.kiss).toEqual({ atLimit: true, morePremium: true });
    expect(today.goodnight).toEqual({ atLimit: true, morePremium: false });
    await undoLittleThing('lt-1');
    expect(mockRpc).toHaveBeenLastCalledWith('undo_little_thing', { p_id: 'lt-1' });
  });
});

describe('little things model', () => {
  it('time of day: 05–11 morning, 11–20 hug, 20–05 goodnight', () => {
    const at = (h: number, m: number) => new Date(2026, 10, 11, h, m);
    expect(timeOfDayKind(at(4, 59))).toBe('goodnight');
    expect(timeOfDayKind(at(5, 0))).toBe('good_morning');
    expect(timeOfDayKind(at(10, 59))).toBe('good_morning');
    expect(timeOfDayKind(at(11, 0))).toBe('hug');
    expect(timeOfDayKind(at(19, 59))).toBe('hug');
    expect(timeOfDayKind(at(20, 0))).toBe('goodnight');
    expect(timeOfDayKind(at(0, 0))).toBe('goodnight');
  });

  it('the fan puts the time-of-day gesture in the middle', () => {
    expect(fanOrder('goodnight')).toEqual(['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you']);
    expect(fanOrder('hug')).toEqual(['kiss', 'goodnight', 'hug', 'good_morning', 'miss_you']);
    expect(fanOrder('good_morning')).toEqual([
      'hug',
      'kiss',
      'good_morning',
      'goodnight',
      'miss_you',
    ]);
  });

  it('the fan is a quarter circle: left of the button to straight above it', () => {
    const o = fanOffsets(232);
    expect(o[0]).toEqual({ x: -232, y: -0 });
    expect(o[4]).toEqual({ x: 0, y: -232 });
  });

  it('amounts: kisses 1..5, a hug in ms up to 5000 (a tap is 2 s), others 1', () => {
    expect(sendAmount('kiss', 0)).toBe(1);
    expect(sendAmount('kiss', 9)).toBe(5);
    expect(sendAmount('hug', 0)).toBe(2000);
    expect(sendAmount('hug', 2500)).toBe(2500);
    expect(sendAmount('hug', 9000)).toBe(5000);
    expect(sendAmount('miss_you', 4)).toBe(1);
  });

  it('parses the limit details; unknown rows are ignored', () => {
    expect(limitDetailsFrom('{"kind":"hug","more_with_premium":false}')).toEqual({
      kind: 'hug',
      morePremium: false,
    });
    expect(limitDetailsFrom('nope')).toBeUndefined();
    expect(limitDetailsFrom({ kind: 'wave' })).toBeUndefined();
    expect(toToday([{ kind: 'wave', at_limit: true, more_with_premium: true }])).toEqual(
      NOTHING_SENT,
    );
  });
});
