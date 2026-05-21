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
  automationArtifacts,
  automationDefinitions,
  automationEvents,
  automationRuns,
  backendCapabilitySnapshots,
  backendRuns,
  backendSessionBindings,
  issueComments,
  issueMilestones,
  issueRelations,
  issues,
  issueStatuses,
  kanbanBoards,
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

import { db, getServerConfig } from '../../infra'
import { abortAllRuns } from '../chat-runtime/service'

const TABLES_IN_DELETION_ORDER = [
  automationEvents,
  automationArtifacts,
  automationRuns,
  automationDefinitions,
  agentActivities,
  agentSessions,
  issueRelations,
  issueComments,
  issues,
  issueMilestones,
  issueStatuses,
  kanbanBoards,
  messages,
  usageLogs,
  sessions,
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

function isPathInside(parentDir: string, childDir: string): boolean {
  const relative = path.relative(parentDir, childDir)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveIsolatedHomeSkillsDir(): string | null {
  const dataDir = getServerConfig().dataDir
  if (!dataDir) {
    return null
  }

  const resolvedDataDir = path.resolve(dataDir)
  const resolvedHomeDir = path.resolve(os.homedir())
  if (!isPathInside(resolvedDataDir, resolvedHomeDir)) {
    return null
  }

  return path.join(resolvedHomeDir, '.cradle', 'skills')
}

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

    const isolatedHomeSkillsDir = resolveIsolatedHomeSkillsDir()
    try {
      if (isolatedHomeSkillsDir && fs.existsSync(isolatedHomeSkillsDir)) {
        fs.rmSync(isolatedHomeSkillsDir, { recursive: true, force: true })
      }
    }
    catch { /* best effort */ }

    return { ok: true as const }
  }, {
    detail: { summary: 'Reset all tables for testing' },
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
