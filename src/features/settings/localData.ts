import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSeenBadges } from '@/features/badges/seen';
import { useCheckIn } from '@/features/feedback/checkIn';
import { useOnboardingSync } from '@/features/onboarding/answerSync';
import { usePendingSetup } from '@/features/onboarding/pendingSetup';
import { useOnboarding } from '@/features/onboarding/store';
import { useMyInvite } from '@/features/pairing/hooks';
import { usePendingJoin } from '@/features/pairing/joinRequest';
import { useOfferShown } from '@/features/premium/offers';
import { resetPurchaser } from '@/features/premium/purchases';
import { unregisterPushToken } from '@/features/push/registration';
import { forgetWidgetToken } from '@/features/widgets/tokens';
import { clearHttpCache } from '@/lib/httpCache';
import { supabase } from '@/lib/supabase';
import { secureStore } from '@/lib/storage';

import { useEndedSeen } from './partnerLeft';

type Wipeable = { clearAll: () => void };

/**
 * After `delete-account` succeeded (43): nothing of the deleted account stays on the phone.
 * - RevenueCat identity reset (`Purchases.logOut`);
 * - this device's push registration mark (the server row went with the account);
 * - the widget token in the keychain/Keystore and the widget snapshot (MOB-77; the server rows
 *   went with the account);
 * - the OS HTTP cache (MOB-89: iOS URLCache, Android OkHttp http-cache);
 * - Supabase session signed out locally: DataProvider then wipes the query cache, the persisted
 *   cache, answer drafts and the outbox (SIGNED_OUT);
 * - every key in the encrypted MMKV store (session, cache, device flags) and the in-memory stores.
 * The MMKV encryption key in the keychain holds no user data and stays. Never throws: the account
 * is already gone, so a local hiccup must not keep the person on the delete screen.
 */
export async function wipeLocalAccount(store: () => Wipeable = secureStore): Promise<void> {
  await resetPurchaser().catch(() => undefined);
  await unregisterPushToken().catch(() => undefined);
  await forgetWidgetToken().catch(() => undefined);
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  clearHttpCache();
  try {
    store().clearAll();
  } catch {
    // Storage unavailable: the sign-out above already removed the session.
  }
  useOnboarding.getState().reset();
  useOnboardingSync.getState().reset();
  usePendingSetup.getState().reset();
  usePendingInvite.getState().clear();
  usePendingJoin.getState().clear();
  useMyInvite.getState().set(null);
  useSeenBadges.setState({ seen: [] });
  useOfferShown.setState({ shown: [] });
  useEndedSeen.setState({ seen: [] });
  useCheckIn.setState({ asked: {} });
}
