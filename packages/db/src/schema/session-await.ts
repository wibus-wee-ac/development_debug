import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { createdAt, textPk, workspaces } from './shared'

export const sessionAwaits = sqliteTable('session_awaits', {
  id: textPk(),
  chatSessionId: text('chat_session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  filterJson: text('filter_json').notNull(),
  status: text('status', {
    enum: ['pending', 'triggered', 'expired', 'cancelled', 'failed'],
  }).notNull().default('pending'),
  reason: text('reason'),
  resumePayloadJson: text('resume_payload_json'),
  ...createdAt(),
  triggeredAt: int('triggered_at'),
  expiresAt: int('expires_at'),
  fireAt: int('fire_at'),
  lastCheckedAt: int('last_checked_at'),
  lastErrorText: text('last_error_text'),
}, table => ([
  index('idx_session_awaits_status').on(table.status),
  index('idx_session_awaits_session').on(table.chatSessionId),
]))
