// Output: i18n validation report and process status.
// Input: Default TypeScript source and locale JSON translation files.
// Position: CI gate backing pnpm i18n:check.

import { collectCheckReport, writeMissingReport } from './utils'

const report = await collectCheckReport()
await writeMissingReport(report)

if (report.summary.missingKeys > 0 || report.summary.extraKeys > 0 || report.summary.invalidEntries > 0) {
  console.error(JSON.stringify(report.summary, null, 2))
  process.exitCode = 1
}
