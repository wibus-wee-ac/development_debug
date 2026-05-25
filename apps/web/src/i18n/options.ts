// Output: User-facing locale options for Cradle's language selector.
// Input: Supported locale model from resources.ts.
// Position: Presentation metadata owned by web i18n.

import type { SupportedLocale } from './resources'

export interface LocaleOption {
  value: SupportedLocale
}

export const localeOptions: LocaleOption[] = [
  { value: 'en-US' },
  { value: 'zh-CN' },
  { value: 'ja-JP' },
  { value: 'es-ES' },
]
