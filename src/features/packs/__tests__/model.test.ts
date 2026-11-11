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

describe('packPreview (D51)', () => {
  it('free couple: one read-only sample, the rest locked without their text', () => {
    const p = packPreview(PACK, false);
    expect(p).toEqual({
      mode: 'locked',
      sample: PACK.questions[0],
      started: [],
      locked: [
        { id: 'q2', position: 2 },
        { id: 'q3', position: 3 },
      ],
    });
    expect(JSON.stringify(p.mode === 'locked' && p.locked)).not.toContain('FIXTURE-second');
  });

  it('premium couple (mine or the partner’s): every question is open', () => {
    expect(packPreview(PACK, true)).toEqual({ mode: 'open', questions: PACK.questions });
  });

  it('the is_premium = false flag no longer opens a pack (BE-46)', () => {
    expect(packPreview({ ...PACK, isPremium: false }, false).mode).toBe('locked');
  });

  it('already-started questions stay openable; the sample is the first one not started', () => {
    const p = packPreview(PACK, false, { q1: 'cq-1', q3: 'cq-3' });
    expect(p).toEqual({
      mode: 'locked',
      sample: PACK.questions[1],
      started: [
        { question: PACK.questions[0], coupleQuestionId: 'cq-1' },
        { question: PACK.questions[2], coupleQuestionId: 'cq-3' },
      ],
      locked: [],
    });
  });

  it('every question started: no sample, nothing locked', () => {
    const p = packPreview(PACK, false, { q1: 'a', q2: 'b', q3: 'c' });
    expect(p.mode === 'locked' && p.sample).toBeNull();
    expect(p.mode === 'locked' && p.locked).toEqual([]);
  });

  it('an empty pack has no sample and nothing locked', () => {
    expect(packPreview({ ...PACK, questions: [] }, false)).toEqual({
      mode: 'locked',
      sample: null,
      started: [],
      locked: [],
    });
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
