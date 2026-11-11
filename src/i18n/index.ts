import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

/**
 * MOB-29: every user-visible string goes through t(). English is the only catalogue for now;
 * a new language is one more JSON file in ./locales plus an entry in `resources`.
 * Never pass answer or message text through t() options that get logged (we don't log any).
 */
export const resources = { en: { translation: en } } as const;
export type Language = keyof typeof resources;
export const fallbackLanguage: Language = 'en';
export const supportedLanguages = Object.keys(resources) as Language[];

/** Device language if we have a catalogue for it, else English. */
export function pickLanguage(): Language {
  for (const locale of getLocales()) {
    const code = locale.languageCode;
    if (code && (supportedLanguages as string[]).includes(code)) return code as Language;
  }
  return fallbackLanguage;
}

/**
 * The phone's own locale tag (e.g. "en-GB"), for dates the person reads as a calendar date: the
 * catalogue language stays "en", but a British phone still shows "12 Dec" (MOB-70, D08).
 */
export function deviceLocale(): string {
  try {
    return getLocales()[0]?.languageTag || fallbackLanguage;
  } catch {
    return fallbackLanguage;
  }
}

// Own instance (not the i18next global); initReactI18next makes it the one useTranslation() reads.
const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: pickLanguage(),
  fallbackLng: fallbackLanguage,
  supportedLngs: supportedLanguages,
  // Synchronous init: resources are bundled, so the first render already has strings.
  initAsync: false,
  // React escapes output itself.
  interpolation: { escapeValue: false },
  returnNull: false,
});

/**
 * `{{partner, capitalize}}` starts a sentence with a name. Names come as typed, and the fallback
 * is "your partner" (it sits mid-sentence elsewhere), so the first letter is raised only there.
 */
export function capitalize(value: unknown): string {
  const text = String(value ?? '');
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
i18n.services.formatter?.add('capitalize', capitalize);

/** For code outside components (e.g. src/lib/errors.ts). Components use useTranslation(). */
export const t = i18n.t.bind(i18n);
export { useTranslation } from 'react-i18next';
export { i18n };
