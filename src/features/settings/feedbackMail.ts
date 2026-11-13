import Constants from 'expo-constants';

/**
 * D62 (MOB-85): Settings 40 "Send feedback" opens an email to the support mailbox. The body
 * carries only the app version and the platform: no account data, no names, no answer text.
 * Always available, never a step before or instead of the OS review sheet.
 */
export function feedbackMailto(input: { to: string; subject: string; body: string }): string {
  const q = `subject=${encodeURIComponent(input.subject)}&body=${encodeURIComponent(input.body)}`;
  return `mailto:${input.to}?${q}`;
}

/** The app version for the email, or `unknown` (never empty). */
export function mailAppVersion(): string {
  return Constants.expoConfig?.version?.trim().slice(0, 40) || 'unknown';
}

/** `iOS` / `Android` (the platform only, no OS build or device model). */
export function mailPlatform(os: string): string {
  return os === 'ios' ? 'iOS' : os === 'android' ? 'Android' : os;
}
