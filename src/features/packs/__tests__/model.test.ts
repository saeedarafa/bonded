import type { PackDetail } from '@/features/packs/api';
import { startFailure } from '@/features/packs/hooks';
import { packPreview, packVisual } from '@/features/packs/model';
import { AppError, toAppError } from '@/lib/errors';

const PACK: PackDetail = {
  id: 'p-1',
  slug: 'future-us',
  title: 'Future Us',
  description: 'd',
  isPremium: true,
  icon: 'future-us',
  questions: [
    { id: 'q1', position: 1, body: 'FIXTURE-first' },
    { id: 'q2', position: 2, body: 'FIXTURE-second' },
    { id: 'q3', position: 3, body: 'FIXTURE-third' },
  ],
};

describe('packPreview', () => {
  it('free couple: the first question is free, the rest are locked without their text', () => {
    const p = packPreview(PACK, false);
    expect(p.free?.id).toBe('q1');
    expect(p.locked).toBe(true);
    expect(p.rows).toEqual([
      { kind: 'locked', id: 'q2', position: 2 },
      { kind: 'locked', id: 'q3', position: 3 },
    ]);
    expect(JSON.stringify(p.rows)).not.toContain('FIXTURE-second');
  });

  it('premium couple (mine or the partner’s): every question is open', () => {
    const p = packPreview(PACK, true);
    expect(p.locked).toBe(false);
    expect(p.rows.map((r) => r.kind)).toEqual(['open', 'open']);
  });

  it('a free pack is open for everyone', () => {
    expect(packPreview({ ...PACK, isPremium: false }, false).locked).toBe(false);
  });

  it('an empty pack has no free question and nothing locked', () => {
    expect(packPreview({ ...PACK, questions: [] }, false)).toEqual({
      free: null,
      rows: [],
      locked: false,
    });
  });

  it('a one-question pack has nothing to unlock', () => {
    expect(packPreview({ ...PACK, questions: PACK.questions.slice(0, 1) }, false).locked).toBe(
      false,
    );
  });
});

describe('packVisual', () => {
  it('maps board 32 icons and falls back for unknown packs', () => {
    expect(packVisual('future-us')).toEqual({ icon: 'compass', tone: 'partner' });
    expect(packVisual('money-home')).toEqual({ icon: 'home', tone: 'success' });
    expect(packVisual('new-thing')).toEqual({ icon: 'packs', tone: 'you' });
    expect(packVisual(null)).toEqual({ icon: 'packs', tone: 'you' });
  });
});

describe('startFailure (PREMIUM_REQUIRED mapping)', () => {
  it('PREMIUM_REQUIRED from the server opens the paywall', () => {
    expect(startFailure(toAppError({ message: 'PREMIUM_REQUIRED', code: 'P0001' }))).toBe(
      'paywall',
    );
  });
  it('QUESTION_UNAVAILABLE means the pack went away', () => {
    expect(startFailure(toAppError({ message: 'QUESTION_UNAVAILABLE' }))).toBe('gone');
  });
  it('anything else is shown as a message', () => {
    expect(startFailure(new AppError('NETWORK', 'offline'))).toBe('message');
    expect(startFailure(toAppError({ message: 'NOT_PAIRED' }))).toBe('message');
    expect(startFailure(toAppError(new Error('boom')))).toBe('message');
  });
});
