// Output: i18next custom type configuration for Cradle resources.
// Input: Default resource source of truth.
// Position: Global module augmentation consumed by react-i18next and i18next.

import type { DefaultResources } from '~/locales/default'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: DefaultResources
    keySeparator: false
  }
}
