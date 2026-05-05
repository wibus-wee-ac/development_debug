// Input: drizzle-orm sqlite schema builders
// Output: Shared schema helpers plus the workspace table and inferred types
// Position: Shared persistence primitives used by context-specific schema modules

import { sql } from 'drizzle-orm'
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const textPk = () => text('id').primaryKey()

export const timestamps = () => ({
  createdAt: int('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: int('updated_at').notNull().default(sql`(unixepoch())`),
})

export const createdAt = () => ({
  createdAt: int('created_at').notNull().default(sql`(unixepoch())`),
})

export const workspaces = sqliteTable('workspaces', {
  id: textPk(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  ...timestamps(),
})

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
