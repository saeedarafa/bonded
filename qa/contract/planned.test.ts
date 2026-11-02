// QA-03: contract rows that later backend tasks add (CONTRACTS §2 rows marked `planned`). Each todo
// becomes a real test in rpc.test.ts / tables.test.ts / invites.test.ts when its task lands on
// main, so the coverage gap stays visible. BE-03, BE-04, BE-05 and BE-24 are live and tested.
import { describe, it } from 'vitest';

describe('BE-06 streak', () => {
  it.todo(
    'get_streak: { current, longest, last_completed_on, saver_available }; NOT_PAIRED (BE-06)',
  );
  it.todo('get_streak: current is already 0 after a missed day (clock pinned) (BE-06)');
});

describe('BE-09 unpair and ended couples (D08)', () => {
  it.todo(
    'unpair: the couple becomes ended, readable for 30 days; a retry gets NOT_PAIRED (BE-09)',
  );
  it.todo('an ended couple is readable via status=ended and no longer via status=active (BE-09)');
});

describe('BE-10 nudges', () => {
  it.todo('send_nudge: PARTNER_ALREADY_ANSWERED, NUDGE_LIMIT, NOT_PAIRED (BE-10)');
});

describe('BE-11 streak saver', () => {
  it.todo('use_streak_saver: PREMIUM_REQUIRED, SAVER_UNAVAILABLE, NOT_PAIRED (BE-11)');
});

describe('BE-14 weekly recap', () => {
  it.todo('weekly_recap: shape; is_full false for a free couple; NOT_PAIRED (BE-14)');
});

describe('BE-17 offers', () => {
  it.todo(
    'get_offer: the first call starts the 24 h clock; the second returns the same expiry (BE-17)',
  );
});

describe('BE-20 thread unread counts', () => {
  it.todo('unread_thread_counts: counts only the partner messages after my read marker (BE-20)');
});
