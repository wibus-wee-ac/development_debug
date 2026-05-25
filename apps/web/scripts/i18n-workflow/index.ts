// Output: Default i18n workflow aggregation.
// Input: Existing baseline JSON, next default resources, and translation JSON files.
// Position: pnpm i18n entrypoint; ordering is diff before baseline generation.

await import('./gen-diff')
await import('./gen-default-locale-json')
