// Output: Public locale model re-exports for app code.
// Input: Locale resources and option metadata.
// Position: Stable import surface for web i18n consumers.

export type { LocaleOption } from './options'
export { localeOptions } from './options'
export type { SupportedLocale } from './resources'
export {
  DEFAULT_LOCALE,
  isRtl,
  isSupportedLocale,
  LOCALE_COOKIE,
  LOCALE_QUERY_PARAM,
  locales,
  matchSupportedLocale,
  normalizeLocale,
  resolveAcceptLanguage,
  resolveBrowserLanguage,
} from './resources'
