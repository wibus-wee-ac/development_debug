import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  acpAgents,
  acpAuditLog,
  agentActivities,
  agentCredentials,
  agentProfiles,
  agents,
  agentSessions,
  backendCapabilitySnapshots,
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssueRelations,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  messages,
  observabilityEvents,
  observabilityIncidents,
  runtimeAuditLog,
  sessions,
  usageLogs,
  workspaces,
} from '@cradle/db'
import { sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { db } from '../../infra'
import { abortAllRuns } from '../chat-runtime/service'

const TABLES_IN_DELETION_ORDER = [
  agentActivities,
  agentSessions,
  kanbanIssueRelations,
  kanbanIssueComments,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  kanbanBoards,
  messages,
  usageLogs,
  sessions,
  backendTimelineEvents,
  backendCapabilitySnapshots,
  backendSessionBindings,
  backendRuns,
  acpAuditLog,
  acpAgents,
  runtimeAuditLog,
  observabilityIncidents,
  observabilityEvents,
  workspaces,
  agents,
  agentCredentials,
  agentProfiles,
] as const

export const testReset = new Elysia({
  prefix: '/test/reset',
  detail: { tags: ['test-reset'] },
})
  .post('/', async () => {
    await abortAllRuns()
    const d = db()
    d.run(sql`PRAGMA foreign_keys = OFF`)
    try {
      for (const table of TABLES_IN_DELETION_ORDER) {
        d.delete(table).run()
      }
    }
    finally {
      d.run(sql`PRAGMA foreign_keys = ON`)
    }

    // Clean up global skills on disk (not in DB)
    const globalSkillsDir = path.join(os.homedir(), '.cradle', 'skills')
    try {
      if (fs.existsSync(globalSkillsDir)) {
        fs.rmSync(globalSkillsDir, { recursive: true, force: true })
      }
    }
    catch { /* best effort */ }

    return { ok: true as const }
  }, {
    detail: { summary: 'Reset all tables for testing' },
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
