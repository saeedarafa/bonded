/**
 * Where `/` sends a signed-in person (MOB-08, MOB-07, D40). Pure, so every branch is unit tested.
 *
 * - SetupBond still writing or about to move on to 09 (#93): stay on SetupBond;
 * - paired: Today;
 * - solo couple: Today, or 10 Invite/Join right after a returning sign-in from 01 (D40);
 * - no couple, answers from the story/quiz on this launch: SetupBond (`create_couple`, 09, then 10);
 * - no couple because my partner unpaired or deleted their account (an ended couple not yet shown
 *   on this device): 58 Partner left (MOB-18). Until that is known: wait;
 * - no couple, no answers, brand-new account: the onboarding story and quiz (still signed in);
 * - no couple, no answers, existing account: SetupBond straight away, so 10 without the story or
 *   quiz again (D40). Until the account age is known: wait.
 */
export type FrontDoor = 'today' | 'invite' | 'setup' | 'onboarding' | 'partnerLeft' | 'checking';

export function frontDoor(input: {
  couple: { paired: boolean } | null;
  returning: boolean;
  hasAnswers: boolean;
  /** null while unknown. */
  newAccount: boolean | null;
  /** #93: SetupBond is in flight (`useSetupInFlight`). */
  settingUp?: boolean;
  /** MOB-18: an unseen ended couple (58). null while still being read; omitted = none. */
  partnerLeft?: boolean | null;
}): FrontDoor {
  if (input.settingUp) return 'setup';
  if (input.couple) return input.couple.paired || !input.returning ? 'today' : 'invite';
  if (input.hasAnswers) return 'setup';
  if (input.partnerLeft === null) return 'checking';
  if (input.partnerLeft) return 'partnerLeft';
  if (input.newAccount === null) return 'checking';
  return input.newAccount ? 'onboarding' : 'setup';
}

/**
 * A first sign-in happens right after the account is created (Apple/Google create it on the spot,
 * an email code within minutes). Anything older has signed in before: a returning person.
 */
export const NEW_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

export function isNewAccount(user: {
  created_at?: string | null;
  last_sign_in_at?: string | null;
}): boolean {
  const created = Date.parse(user.created_at ?? '');
  const lastSignIn = Date.parse(user.last_sign_in_at ?? '');
  if (Number.isNaN(created)) return false;
  // No sign-in recorded yet means this is the first one.
  if (Number.isNaN(lastSignIn)) return true;
  return lastSignIn - created < NEW_ACCOUNT_WINDOW_MS;
}
