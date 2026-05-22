import {
  automationDefinitions,
  automationRuns,
  sessionAwaits,
  sessions,
  workspaces,
} from '@cradle/db'
import { desc, eq, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as Approval from '../approval/service'
import * as ChatRuntime from '../chat-runtime/service'
import * as Chronicle from '../chronicle/service'

interface TraySessionItem {
  id: string
  sessionId: string
  title: string
  workspaceId: string | null
  workspaceName: string
  runtimeKind: string
  modelId: string | null
  updatedAt: number
  detail: string
}

interface TrayMetric {
  id: string
  label: string
  value: string
  tone: 'neutral' | 'active' | 'warning' | 'danger'
}

interface TrayQuickAction {
  id: string
  label: string
  description: string
  accelerator: string | null
  badge: string | null
  enabled: boolean
}

interface TrayAwaitItem {
  id: string
  sessionId: string
  title: string
  workspaceId: string | null
  workspaceName: string
  source: string
  reason: string | null
  createdAt: number
}

export interface TraySnapshot {
  generatedAt: number
  running: TraySessionItem[]
  resident: TraySessionItem[]
  metrics: TrayMetric[]
  quickActions: TrayQuickAction[]
}

const DEFAULT_WORKSPACE_NAME = 'No workspace'
const DEFAULT_SESSION_TITLE = 'Waiting session'
const RUNNING_LIMIT = 8
const RESIDENT_LIMIT = 10
const AWAIT_LIMIT = 20
const WorkspaceIdsSchema = z.array(z.string().nullable())
  .transform(workspaceIds => [...new Set(workspaceIds.flatMap(id => id ? [id] : []))])

function readWorkspaceNames(workspaceIds: Array<string | null>): Map<string, string> {
  const ids = WorkspaceIdsSchema.parse(workspaceIds)
  if (ids.length === 0) {
    return new Map()
  }

  const rows = db()
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(inArray(workspaces.id, ids))
    .all()

  return new Map(rows.map(row => [row.id, row.name]))
}

function readSessionTitles(sessionIds: string[]): Map<string, string> {
  const ids = [...new Set(sessionIds.filter(id => id.length > 0))]
  if (ids.length === 0) {
    return new Map()
  }

  const rows = db()
    .select({ id: sessions.id, title: sessions.title })
    .from(sessions)
    .where(inArray(sessions.id, ids))
    .all()

  return new Map(rows.map(row => [row.id, row.title]))
}

function toTrayItem(
  row: typeof sessions.$inferSelect,
  workspaceNames: Map<string, string>,
  detail: string,
  modelId: string | null,
): TraySessionItem {
  const workspaceName = row.workspaceId ? workspaceNames.get(row.workspaceId) ?? DEFAULT_WORKSPACE_NAME : DEFAULT_WORKSPACE_NAME

  return {
    id: row.id,
    sessionId: row.id,
    title: row.title,
    workspaceId: row.workspaceId,
    workspaceName,
    runtimeKind: row.runtimeKind,
    modelId,
    updatedAt: row.updatedAt,
    detail,
  }
}

function readRunningItems(): TraySessionItem[] {
  const activeRuns = ChatRuntime.listActiveRunSummaries()
  if (activeRuns.length === 0) {
    return []
  }

  const runBySessionId = new Map(activeRuns.map(run => [run.sessionId, run]))
  const rows = db()
    .select()
    .from(sessions)
    .where(inArray(sessions.id, [...runBySessionId.keys()]))
    .all()
  const workspaceNames = readWorkspaceNames(rows.map(row => row.workspaceId))

  return rows
    .map(row => toTrayItem(
      row,
      workspaceNames,
      `Running ${row.runtimeKind}`,
      runBySessionId.get(row.id)?.modelId ?? null,
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RUNNING_LIMIT)
}

function readResidentItems(activeSessionIds: Set<string>): TraySessionItem[] {
  const rows = db()
    .select()
    .from(sessions)
    .where(eq(sessions.pinned, 1))
    .orderBy(desc(sessions.updatedAt))
    .limit(RESIDENT_LIMIT)
    .all()
  const workspaceNames = readWorkspaceNames(rows.map(row => row.workspaceId))

  return rows.map(row => toTrayItem(
    row,
    workspaceNames,
    activeSessionIds.has(row.id) ? `Running ${row.runtimeKind}` : `Resident ${row.runtimeKind}`,
    null,
  ))
}

function readAutomationCounts(): { enabled: number, running: number } {
  const enabled = db()
    .select({ count: sql<number>`count(*)` })
    .from(automationDefinitions)
    .where(eq(automationDefinitions.enabled, true))
    .get()?.count ?? 0

  const running = db()
    .select({ count: sql<number>`count(*)` })
    .from(automationRuns)
    .where(or(eq(automationRuns.status, 'queued'), eq(automationRuns.status, 'running')))
    .get()?.count ?? 0

  return { enabled, running }
}

function readAwaitCount(): number {
  return db()
    .select({ count: sql<number>`count(*)` })
    .from(sessionAwaits)
    .where(eq(sessionAwaits.status, 'pending'))
    .get()?.count ?? 0
}

export function getTrayAwaits(): TrayAwaitItem[] {
  const rows = db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.status, 'pending'))
    .orderBy(desc(sessionAwaits.createdAt))
    .limit(AWAIT_LIMIT)
    .all()
  const workspaceNames = readWorkspaceNames(rows.map(row => row.workspaceId))
  const sessionTitles = readSessionTitles(rows.map(row => row.chatSessionId))

  return rows.map(row => ({
    id: row.id,
    sessionId: row.chatSessionId,
    title: sessionTitles.get(row.chatSessionId) ?? DEFAULT_SESSION_TITLE,
    workspaceId: row.workspaceId,
    workspaceName: workspaceNames.get(row.workspaceId) ?? DEFAULT_WORKSPACE_NAME,
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt,
  }))
}

function readWorkspaceCount(): number {
  return db()
    .select({ count: sql<number>`count(*)` })
    .from(workspaces)
    .get()?.count ?? 0
}

async function readChronicleMetric(): Promise<TrayMetric> {
  try {
    const status = await Chronicle.getStatus()
    return {
      id: 'chronicle',
      label: 'Chronicle',
      value: status.running ? 'Running' : 'Idle',
      tone: status.running ? 'active' : 'neutral',
    }
  }
  catch {
    return {
      id: 'chronicle',
      label: 'Chronicle',
      value: 'Unavailable',
      tone: 'warning',
    }
  }
}

function buildQuickActions(input: {
  runningCount: number
  residentCount: number
  pendingApprovalCount: number
  pendingAwaitCount: number
  enabledAutomationCount: number
  runningAutomationCount: number
  workspaceCount: number
}): TrayQuickAction[] {
  return [
    {
      id: 'open-app',
      label: 'Open Cradle',
      description: 'Bring the main desktop window forward.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
    {
      id: 'new-chat',
      label: 'New Chat',
      description: 'Start a fresh agent conversation.',
      accelerator: '⌘N',
      badge: null,
      enabled: true,
    },
    {
      id: 'global-search',
      label: 'Search Threads',
      description: 'Open the command palette for threads, files, and issues.',
      accelerator: '⌘K',
      badge: null,
      enabled: true,
    },
    {
      id: 'open-resident',
      label: 'Resident Chats',
      description: 'Jump to pinned sessions kept close at hand.',
      accelerator: null,
      badge: input.residentCount > 0 ? String(input.residentCount) : null,
      enabled: input.residentCount > 0,
    },
    {
      id: 'open-running',
      label: 'Running Agents',
      description: 'Focus the most recent active agent run.',
      accelerator: null,
      badge: input.runningCount > 0 ? String(input.runningCount) : null,
      enabled: input.runningCount > 0,
    },
    {
      id: 'open-approvals',
      label: 'Approvals',
      description: 'Review pending tool approvals.',
      accelerator: null,
      badge: input.pendingApprovalCount > 0 ? String(input.pendingApprovalCount) : null,
      enabled: true,
    },
    {
      id: 'open-awaits',
      label: 'Awaits',
      description: 'Check sessions waiting on external signals.',
      accelerator: null,
      badge: input.pendingAwaitCount > 0 ? String(input.pendingAwaitCount) : null,
      enabled: true,
    },
    {
      id: 'open-automation',
      label: 'Automations',
      description: 'Inspect scheduled agent work and recent runs.',
      accelerator: null,
      badge: input.runningAutomationCount > 0 ? String(input.runningAutomationCount) : String(input.enabledAutomationCount),
      enabled: true,
    },
    {
      id: 'open-workspaces',
      label: 'Workspaces',
      description: 'Open the workspace hub.',
      accelerator: null,
      badge: input.workspaceCount > 0 ? String(input.workspaceCount) : null,
      enabled: true,
    },
    {
      id: 'open-agents',
      label: 'Agents',
      description: 'Manage resident agent profiles and runtime defaults.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
    {
      id: 'open-providers',
      label: 'Providers',
      description: 'Review model providers and connection settings.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
    {
      id: 'open-chronicle',
      label: 'Chronicle',
      description: 'View local activity memory and capture status.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
    {
      id: 'open-usage',
      label: 'Usage',
      description: 'Review token and cost analytics.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
    {
      id: 'open-plugins',
      label: 'Plugins',
      description: 'Inspect plugin capability surfaces.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
    {
      id: 'open-desktop-settings',
      label: 'Desktop Updates',
      description: 'Check update status and desktop settings.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
  ]
}

export async function getTraySnapshot(): Promise<TraySnapshot> {
  const running = readRunningItems()
  const activeSessionIds = new Set(running.map(item => item.sessionId))
  const resident = readResidentItems(activeSessionIds)
  const pendingApprovalCount = Approval.listPending().length
  const pendingAwaitCount = readAwaitCount()
  const automationCounts = readAutomationCounts()
  const workspaceCount = readWorkspaceCount()
  const chronicleMetric = await readChronicleMetric()

  const metrics: TrayMetric[] = [
    {
      id: 'running',
      label: 'Running',
      value: String(running.length),
      tone: running.length > 0 ? 'active' : 'neutral',
    },
    {
      id: 'resident',
      label: 'Resident',
      value: String(resident.length),
      tone: resident.length > 0 ? 'active' : 'neutral',
    },
    {
      id: 'approvals',
      label: 'Approvals',
      value: String(pendingApprovalCount),
      tone: pendingApprovalCount > 0 ? 'warning' : 'neutral',
    },
    {
      id: 'awaits',
      label: 'Awaits',
      value: String(pendingAwaitCount),
      tone: pendingAwaitCount > 0 ? 'warning' : 'neutral',
    },
    {
      id: 'automations',
      label: 'Automations',
      value: automationCounts.running > 0
        ? `${automationCounts.running} active`
        : `${automationCounts.enabled} enabled`,
      tone: automationCounts.running > 0 ? 'active' : 'neutral',
    },
    chronicleMetric,
  ]

  return {
    generatedAt: currentUnixSeconds(),
    running,
    resident,
    metrics,
    quickActions: buildQuickActions({
      runningCount: running.length,
      residentCount: resident.length,
      pendingApprovalCount,
      pendingAwaitCount,
      enabledAutomationCount: automationCounts.enabled,
      runningAutomationCount: automationCounts.running,
      workspaceCount,
    }),
  }
}
