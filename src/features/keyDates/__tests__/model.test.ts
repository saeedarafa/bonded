import { upsertKeyDates } from '@/features/keyDates/api';
import {
  checkDate,
  formatKeyDate,
  keyDateRows,
  localIsoDate,
  partsFromIso,
} from '@/features/keyDates/model';
import { AppError } from '@/lib/errors';

const mockUpsert = jest.fn();
const mockFrom = jest.fn((_table: string) => ({ upsert: mockUpsert }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

const TODAY = '2026-11-03';
const date = (year: string, month: string, day: string) => checkDate({ year, month, day }, TODAY);

describe('checkDate', () => {
  it('treats an untouched field as empty (the date is optional)', () => {
    expect(date('', '', '')).toEqual({ status: 'empty' });
    expect(date(' ', '', ' ')).toEqual({ status: 'empty' });
  });

  it('asks for all three parts', () => {
    expect(date('2023', '3', '')).toEqual({ status: 'incomplete' });
    expect(date('', '03', '14')).toEqual({ status: 'incomplete' });
  });

  it('accepts a real past date and pads it to ISO', () => {
    expect(date('2023', '3', '14')).toEqual({ status: 'ok', iso: '2023-03-14' });
    expect(date('1990', '05', '09')).toEqual({ status: 'ok', iso: '1990-05-09' });
    expect(date('2026', '11', '03')).toEqual({ status: 'ok', iso: TODAY });
  });

  it.each([
    ['month 13', '2023', '13', '1'],
    ['month 0', '2023', '0', '1'],
    ['day 0', '2023', '1', '0'],
    ['31 April', '2023', '4', '31'],
    ['29 February in a common year', '2023', '2', '29'],
    ['a two-digit year', '23', '3', '14'],
    ['before 1900', '1899', '12', '31'],
    ['letters', '20a3', '3', '14'],
  ])('rejects %s', (_name, y, m, d) => {
    expect(date(y, m, d)).toEqual({ status: 'invalid' });
  });

  it('allows 29 February in a leap year', () => {
    expect(date('2024', '2', '29')).toEqual({ status: 'ok', iso: '2024-02-29' });
  });

  it('rejects a date after today', () => {
    expect(date('2026', '11', '04')).toEqual({ status: 'future' });
    expect(date('2030', '1', '1')).toEqual({ status: 'future' });
  });
});

describe('helpers', () => {
  it('localIsoDate uses the device calendar day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('partsFromIso round-trips a saved date and ignores anything else', () => {
    expect(partsFromIso('2023-03-14')).toEqual({ year: '2023', month: '03', day: '14' });
    expect(partsFromIso(undefined)).toEqual({ year: '', month: '', day: '' });
    expect(partsFromIso('nope')).toEqual({ year: '', month: '', day: '' });
  });

  it('formatKeyDate shows the calendar day without shifting it by timezone', () => {
    expect(formatKeyDate('1990-05-09', 'en')).toBe('May 9');
    expect(formatKeyDate('2023-03-14', 'en', true)).toBe('Mar 14, 2023');
  });
});

describe('keyDateRows (the upsert payload, CONTRACTS §2)', () => {
  it('writes the couple dates without a user and only my own birthday', () => {
    expect(
      keyDateRows({
        coupleId: 'c1',
        userId: 'me',
        dates: { together_since: '2023-03-14', anniversary: '2024-06-01', birthday: '1990-05-09' },
        remindWeekBefore: true,
      }),
    ).toEqual([
      {
        couple_id: 'c1',
        kind: 'together_since',
        user_id: null,
        date: '2023-03-14',
        remind_week_before: true,
      },
      {
        couple_id: 'c1',
        kind: 'anniversary',
        user_id: null,
        date: '2024-06-01',
        remind_week_before: true,
      },
      {
        couple_id: 'c1',
        kind: 'birthday',
        user_id: 'me',
        date: '1990-05-09',
        remind_week_before: true,
      },
    ]);
  });

  it('leaves out the dates that were skipped, and carries the reminder choice', () => {
    expect(
      keyDateRows({
        coupleId: 'c1',
        userId: 'me',
        dates: { birthday: '1990-05-09' },
        remindWeekBefore: false,
      }),
    ).toEqual([
      {
        couple_id: 'c1',
        kind: 'birthday',
        user_id: 'me',
        date: '1990-05-09',
        remind_week_before: false,
      },
    ]);
    expect(
      keyDateRows({ coupleId: 'c1', userId: 'me', dates: {}, remindWeekBefore: true }),
    ).toEqual([]);
  });
});

describe('upsertKeyDates', () => {
  const ROW = {
    couple_id: 'c1',
    kind: 'birthday' as const,
    user_id: 'me',
    date: '1990-05-09',
    remind_week_before: true,
  };
  beforeEach(() => jest.clearAllMocks());

  it('upserts on the contract conflict target', async () => {
    mockUpsert.mockResolvedValue({ data: null, error: null });
    await upsertKeyDates([ROW]);
    expect(mockFrom).toHaveBeenCalledWith('key_dates');
    expect(mockUpsert).toHaveBeenCalledWith([ROW], { onConflict: 'couple_id,kind,user_id' });
  });

  it('makes no call when there is nothing to write', async () => {
    await upsertKeyDates([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('turns an RLS refusal into an AppError (not a sign-out)', async () => {
    mockUpsert.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'new row violates row-level security policy for table "key_dates"',
      },
    });
    const error = await upsertKeyDates([ROW]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ kind: 'UNKNOWN' });
    expect((error as AppError).signedOut).toBe(false);
  });
});
