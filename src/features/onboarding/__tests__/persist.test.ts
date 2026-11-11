import { memoryStorage } from '@/test/memoryStorage';

import { createOnboardingStore, quizInProgress, resumeStep } from '../store';

describe('onboarding store kept on the phone (MOB-61b)', () => {
  it('every answer, date and the step survive an app restart', () => {
    const disk = memoryStorage();
    const before = createOnboardingStore(disk).getState();
    before.setStage('long_distance');
    before.setNames({ displayName: 'Maya', partnerName: 'Sam' });
    before.setLastLearned('this_week');
    before.toggleGoal('future');
    before.toggleGoal('romance');
    before.setKeyDates({ together_since: '2020-02-01', birthday: '1990-05-09' }, false);
    before.setReturning(true);
    before.setStep('/quiz/dates');
    // A new launch reads the same encrypted store.
    const after = createOnboardingStore(disk).getState();
    expect(after).toMatchObject({
      stage: 'long_distance',
      displayName: 'Maya',
      partnerName: 'Sam',
      lastLearned: 'this_week',
      goals: ['romance', 'future'],
      keyDates: { together_since: '2020-02-01', birthday: '1990-05-09' },
      remindWeekBefore: false,
      returning: true,
      step: '/quiz/dates',
      answeredAt: {
        stage: expect.any(String),
        last_learned: expect.any(String),
        goals: expect.any(String),
      },
    });
    expect(resumeStep(after)).toBe('/quiz/dates');
    expect(quizInProgress(after)).toBe('/quiz/dates');
  });

  it('reset (setup done or ALREADY_PAIRED) leaves nothing for the next launch', () => {
    const disk = memoryStorage();
    const store = createOnboardingStore(disk);
    store.getState().setStage('dating');
    store.getState().setStep('/story/1');
    expect(disk.data.size).toBe(1);
    store.getState().reset();
    expect(disk.data.size).toBe(0);
    expect(createOnboardingStore(disk).getState()).toMatchObject({ stage: null, step: null });
  });

  it('a fresh phone on 01 writes nothing; 01 and 08 are not quiz steps', () => {
    const disk = memoryStorage();
    const store = createOnboardingStore(disk);
    store.getState().setStep('/welcome');
    expect(disk.data.size).toBe(0);
    expect(resumeStep(store.getState())).toBeNull();
    store.getState().setStep('/sign-in');
    expect(resumeStep(store.getState())).toBe('/sign-in');
    expect(quizInProgress(store.getState())).toBeNull();
  });

  it('drops a damaged or unknown copy instead of failing', () => {
    const disk = memoryStorage();
    disk.setItem(
      'quiz',
      JSON.stringify({
        stage: 'married_twice',
        goals: ['romance', 'nope', 3],
        displayName: 'x'.repeat(80),
        partnerName: 7,
        keyDates: { birthday: 'May 9', anniversary: '2021-06-01', partner_birthday: '1990-01-01' },
        answeredAt: { stage: 'never', goals: '2026-11-11T10:00:00Z', other: 'x' },
        remindWeekBefore: 'no',
        returning: 'yes',
        step: '/today',
      }),
    );
    expect(createOnboardingStore(disk).getState()).toMatchObject({
      stage: null,
      goals: ['romance'],
      displayName: 'x'.repeat(40),
      partnerName: '',
      keyDates: { anniversary: '2021-06-01' },
      answeredAt: { goals: '2026-11-11T10:00:00Z' },
      remindWeekBefore: true,
      returning: false,
      step: null,
    });
    disk.setItem('quiz', 'not json');
    expect(createOnboardingStore(disk).getState().stage).toBeNull();
    disk.setItem('quiz', 'null');
    expect(createOnboardingStore(disk).getState().stage).toBeNull();
  });

  it('a storage failure keeps the answers in memory for this launch', () => {
    const broken = {
      getItem: () => {
        throw new Error('locked');
      },
      setItem: () => {
        throw new Error('locked');
      },
      removeItem: () => {
        throw new Error('locked');
      },
    };
    const store = createOnboardingStore(broken);
    store.getState().setStage('engaged_married');
    expect(store.getState().stage).toBe('engaged_married');
  });
});
