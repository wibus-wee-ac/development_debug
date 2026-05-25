// Output: Generated default locale baseline JSON files.
// Input: TypeScript resources from src/locales/default.
// Position: Workflow command backing pnpm i18n:gen-default.

import { allNamespaces } from '../../src/locales/default'
import { DEFAULT_LOCALE } from '../../src/i18n/locales'
import { defaultNamespaceEntries, localeNamespacePath, resolveFromWebRoot, sortedRecord, writeJson } from './utils'

for (const namespace of allNamespaces) {
  await writeJson(
    resolveFromWebRoot(localeNamespacePath(DEFAULT_LOCALE, namespace)),
    sortedRecord(defaultNamespaceEntries(namespace)),
  )
}
