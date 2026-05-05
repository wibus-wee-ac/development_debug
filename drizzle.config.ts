// Input: Drizzle Kit CLI and the canonical main-process schema barrel path
// Output: Drizzle migration generation configuration for the SQLite app database
// Position: Repository-level Drizzle config that points tooling at the current schema baseline

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/db/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
