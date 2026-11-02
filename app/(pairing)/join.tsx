import { useRouter } from 'expo-router';

import { JoinCodeView } from '@/features/pairing/JoinCodeView';

/** 12 Join with code: a signed-in person types the code their partner sent. */
export default function PairingJoinRoute() {
  const router = useRouter();
  return (
    <JoinCodeView
      mode="account"
      initialCode=""
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}
