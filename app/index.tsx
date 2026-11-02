import { Redirect } from 'expo-router';

// Session / pairing gating replaces this redirect in MOB-08.
export default function Index() {
  return <Redirect href="/welcome" />;
}
