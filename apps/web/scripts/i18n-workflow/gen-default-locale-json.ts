import { DEFAULT_LOCALE } from '../../src/i18n/locales'
import { allNamespaces } from '../../src/locales/default'
import { defaultNamespaceEntries, localeNamespacePath, resolveFromWebRoot, sortedRecord, writeJson } from './utils'

for (const namespace of allNamespaces) {
  await writeJson(
    resolveFromWebRoot(localeNamespacePath(DEFAULT_LOCALE, namespace)),
    sortedRecord(defaultNamespaceEntries(namespace)),
  )
}
