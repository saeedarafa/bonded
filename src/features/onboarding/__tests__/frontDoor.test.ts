import { frontDoor, isNewAccount, NEW_ACCOUNT_WINDOW_MS } from '@/features/onboarding/frontDoor';
import { hasOnboardingAnswers } from '@/features/onboarding/store';

const base = { returning: false, hasAnswers: false, newAccount: false };

describe('frontDoor (D40)', () => {
  it('sends a paired couple to Today, even after a returning sign-in', () => {
    expect(frontDoor({ ...base, couple: { paired: true } })).toBe('today');
    expect(frontDoor({ ...base, couple: { paired: true }, returning: true })).toBe('today');
  });

  it('sends a solo couple to Today, or to 10 right after a returning sign-in', () => {
    expect(frontDoor({ ...base, couple: { paired: false } })).toBe('today');
    expect(frontDoor({ ...base, couple: { paired: false }, returning: true })).toBe('invite');
  });

  it('without a couple: setup when the quiz was answered on this launch', () => {
    expect(frontDoor({ ...base, couple: null, hasAnswers: true, newAccount: true })).toBe('setup');
    expect(frontDoor({ ...base, couple: null, hasAnswers: true, newAccount: null })).toBe('setup');
  });

  it('without a couple or answers: onboarding only for a brand-new account', () => {
    expect(frontDoor({ ...base, couple: null, newAccount: true })).toBe('onboarding');
    expect(frontDoor({ ...base, couple: null, newAccount: false })).toBe('setup');
    expect(frontDoor({ ...base, couple: null, newAccount: false, returning: true })).toBe('setup');
    expect(frontDoor({ ...base, couple: null, newAccount: null })).toBe('checking');
  });
});

describe('frontDoor after my partner left (MOB-18, 58)', () => {
  it('shows 58 for an unseen ended couple, waits while that is being read', () => {
    expect(frontDoor({ ...base, couple: null, partnerLeft: true })).toBe('partnerLeft');
    expect(frontDoor({ ...base, couple: null, partnerLeft: null })).toBe('checking');
    expect(frontDoor({ ...base, couple: null, partnerLeft: false })).toBe('setup');
  });

  it('never over an active couple, answers on this launch or a running setup', () => {
    expect(frontDoor({ ...base, couple: { paired: false }, partnerLeft: true })).toBe('today');
    expect(frontDoor({ ...base, couple: null, hasAnswers: true, partnerLeft: true })).toBe('setup');
    expect(frontDoor({ ...base, couple: null, settingUp: true, partnerLeft: true })).toBe('setup');
  });
});

describe('frontDoor while SetupBond is in flight (#93)', () => {
  it('stays on setup whatever the couple, answers or account age say', () => {
    expect(frontDoor({ ...base, couple: null, newAccount: true, settingUp: true })).toBe('setup');
    expect(frontDoor({ ...base, couple: { paired: false }, settingUp: true })).toBe('setup');
    expect(frontDoor({ ...base, couple: null, newAccount: null, settingUp: true })).toBe('setup');
  });
});

describe('isNewAccount', () => {
  const created = '2026-11-04T10:00:00Z';
  const plus = (ms: number) => new Date(Date.parse(created) + ms).toISOString();

  it('is new when the first sign-in follows the creation within the window', () => {
    expect(isNewAccount({ created_at: created, last_sign_in_at: plus(2 * 60_000) })).toBe(true);
    expect(isNewAccount({ created_at: created, last_sign_in_at: null })).toBe(true);
  });

  it('is returning once the account is older than the window', () => {
    expect(
      isNewAccount({ created_at: created, last_sign_in_at: plus(NEW_ACCOUNT_WINDOW_MS) }),
    ).toBe(false);
    expect(isNewAccount({ created_at: created, last_sign_in_at: plus(30 * 86_400_000) })).toBe(
      false,
    );
  });

  it('treats a missing creation date as returning (never onboarding again by mistake)', () => {
    expect(isNewAccount({ created_at: null, last_sign_in_at: created })).toBe(false);
  });
});

describe('hasOnboardingAnswers', () => {
  const empty = {
    lastLearned: null,
    stage: null,
    goals: [],
    displayName: '',
    partnerName: '',
  };
  it('is false for an untouched store and true after any answer', () => {
    expect(hasOnboardingAnswers(empty)).toBe(false);
    expect(hasOnboardingAnswers({ ...empty, displayName: '  ' })).toBe(false);
    expect(hasOnboardingAnswers({ ...empty, stage: 'dating' })).toBe(true);
    expect(hasOnboardingAnswers({ ...empty, goals: ['romance'] })).toBe(true);
    expect(hasOnboardingAnswers({ ...empty, lastLearned: 'this_week' })).toBe(true);
    expect(hasOnboardingAnswers({ ...empty, partnerName: 'Sam' })).toBe(true);
  });
});
