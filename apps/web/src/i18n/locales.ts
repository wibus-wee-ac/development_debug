// Output: Public locale model re-exports for app code.
// Input: Locale resources and option metadata.
// Position: Stable import surface for web i18n consumers.

export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_QUERY_PARAM,
  isRtl,
  isSupportedLocale,
  locales,
  matchSupportedLocale,
  normalizeLocale,
  resolveAcceptLanguage,
  resolveBrowserLanguage,
} from './resources'
export type { SupportedLocale } from './resources'

export { localeOptions } from './options'
export type { LocaleOption } from './options'
