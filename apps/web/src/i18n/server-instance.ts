// Output: Request-independent i18next instance factory for non-React callers and tests.
// Input: Supported locale plus namespaces requested by the caller.
// Position: Shared helper; callers own where translated strings are injected.

import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'

import enUS from '~/locales/default'

import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from './locales'
import { getI18nSettings } from './settings'

export async function createServerI18n(locale: SupportedLocale, ns: string | string[]) {
  const instance = createInstance()

  await instance
    .use(
      resourcesToBackend(async (lng: string, namespace: string) => {
        const normalizedLocale = normalizeLocale(lng)

        if (normalizedLocale === DEFAULT_LOCALE) {
          return enUS[namespace as keyof typeof enUS] ?? {}
        }

        try {
          const mod = await import(`../locales/${normalizedLocale}/${namespace}.json`)
          return mod.default ?? mod
        }
        catch {
          return enUS[namespace as keyof typeof enUS] ?? {}
        }
      }),
    )
    .init(getI18nSettings(locale, ns))

  return instance
}
