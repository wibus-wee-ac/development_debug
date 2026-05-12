import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './packages/db/src/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
