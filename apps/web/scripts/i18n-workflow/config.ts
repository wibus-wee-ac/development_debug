// Output: i18n workflow filesystem configuration for the web app.
// Input: Process working directory under apps/web.
// Position: Shared config for generation, checking, diffing, locale init, and cleanup scripts.

export interface I18nWorkflowConfig {
  defaultLocale: string
  localesDir: string
  reportsDir: string
  sourceLocaleDir: string
  sourceLocaleIndex: string
}

export const i18nWorkflowConfig: I18nWorkflowConfig = {
  defaultLocale: 'en-US',
  localesDir: 'src/locales',
  reportsDir: '.',
  sourceLocaleDir: 'src/locales/default',
  sourceLocaleIndex: 'src/locales/default/index.ts',
}
