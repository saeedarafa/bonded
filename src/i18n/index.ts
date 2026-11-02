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

/** For code outside components (e.g. src/lib/errors.ts). Components use useTranslation(). */
export const t = i18n.t.bind(i18n);
export { useTranslation } from 'react-i18next';
export { i18n };
