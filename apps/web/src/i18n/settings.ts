// Output: Shared i18next initialization options.
// Input: Runtime locale and namespace selection.
// Position: Used by browser provider, server-style helpers, and tests.

import type { InitOptions } from 'i18next'

import { DEFAULT_LOCALE } from './locales'

export function getI18nSettings(lng: string, ns: string | string[] = 'common'): InitOptions {
  return {
    lng,
    fallbackLng: DEFAULT_LOCALE,
    ns,
    defaultNS: 'common',
    keySeparator: false,
    interpolation: {
      escapeValue: false,
    },
  }
}
