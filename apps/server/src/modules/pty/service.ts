// Input: session/profile/workspace ownership plus PTY runtime commands
// Output: PTY control semantics for chat sessions, shell leases, and WebSocket live-channel entrypoints
// Position: apps/server/src/modules/pty business owner that coordinates runtime, timeline, and socket adapters

import type { Workspace } from '@cradle/db'
import { agentProfiles, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { cliTuiConfigSchema } from '../../helpers/provider-config-schemas'
import { getSystemWorkflow } from '../../helpers/system-workflow'
import { db } from '../../infra'
import * as SessionService from '../session/service'
import type { PtyClientEvent } from './protocol'
import { PtySocketHub, type PtyLiveSocket } from './pty.socket'
import { PtyRuntimeRegistry } from './pty.runtime'
import { ptyTimeline } from './pty.timeline'

const shellLeaseTimers = new Map<string, ReturnType<typeof setTimeout>>()

const ptyRuntime = new PtyRuntimeRegistry({
  onOutput: (sessionId, data) => {
    ptyTimeline.appendOutput(sessionId, data)
  },
  onExit: (sessionId, exit) => {
    ptyTimeline.appendExit(sessionId, exit)
  },
  onRelease: (sessionId) => {
    cancelShellLeaseExpiry(sessionId)
    ptyTimeline.delete(sessionId)
  },
})

const ptySocketHub = new PtySocketHub(ptyRuntime, ptyTimeline)

SessionService.onSessionCleanup((sessionId) => {
  cancelShellLeaseExpiry(sessionId)
  ptyRuntime.destroy(sessionId)
})

export interface TerminalSessionContext {
  session: TerminalSessionRecord
  workspace: Workspace
  profile: TerminalProfileRecord
}

interface TerminalSessionRecord {
  id: string
  workspaceId: string
  agentProfileId: string
  runtimeKind: string
  ptyStartedAt: number | null
}

interface TerminalProfileRecord {
  id: string
  providerKind: string
  configJson: string
}

function getSession(sessionId: string): TerminalSessionRecord | undefined {
  return db().select({
    id: sessions.id,
    workspaceId: sessions.workspaceId,
    agentProfileId: sessions.agentProfileId,
    runtimeKind: sessions.runtimeKind,
    ptyStartedAt: sessions.ptyStartedAt,
  }).from(sessions).where(eq(sessions.id, sessionId)).get()
}

function getTerminalContext(sessionId: string): TerminalSessionContext | null {
  const session = getSession(sessionId)
  if (!session) {
    return null
  }

  const workspace = db().select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
  const profile = db().select({
    id: agentProfiles.id,
    providerKind: agentProfiles.providerKind,
    configJson: agentProfiles.configJson,
  }).from(agentProfiles).where(eq(agentProfiles.id, session.agentProfileId)).get() as TerminalProfileRecord | undefined
  if (!workspace || !profile) {
    return null
  }

  return { session, workspace, profile }
}

function requireSession(sessionId: string): TerminalSessionRecord {
  const session = getSession(sessionId)
  if (!session) {
    throw new AppError({ code: 'terminal_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId } })
  }
  return session
}

function requireTerminalContext(sessionId: string): TerminalSessionContext {
  const context = getTerminalContext(sessionId)
  if (!context) {
    throw new AppError({ code: 'terminal_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId } })
  }
  return context
}

function requireTimelineSession(sessionId: string, message: string): void {
  if (!ptyTimeline.hasSession(sessionId)) {
    throw new AppError({ code: 'terminal_not_found', status: 404, message, details: { sessionId } })
  }
}

function readCliConfig(configJson: string): { executable: string, args: string[], env?: Record<string, string> } {
  try {
    const parsed = cliTuiConfigSchema.safeParse(JSON.parse(configJson))
    const config = parsed.success ? parsed.data : {}
    return {
      executable: config.executable ?? process.env.SHELL ?? '/bin/sh',
      args: config.args ?? [],
      env: config.env,
    }
  }
  catch {
    return { executable: process.env.SHELL ?? '/bin/sh', args: [] }
  }
}

function isClaudeCli(executable: string): boolean {
  const base = executable.split('/').pop() ?? ''
  return base === 'claude' || base.startsWith('claude-')
}

export function startOrAttach(input: { sessionId: string, cols: number, rows: number }) {
  const context = requireTerminalContext(input.sessionId)
  if (context.session.runtimeKind !== 'cli-tui') {
    throw new AppError({
      code: 'terminal_profile_not_supported',
      status: 409,
      message: 'Terminal runtime only supports cli-tui sessions',
      details: { sessionId: input.sessionId, runtimeKind: context.session.runtimeKind },
    })
  }

  const config = readCliConfig(context.profile.configJson)
  const args = [...config.args]

  if (isClaudeCli(config.executable)) {
    if (context.session.ptyStartedAt) {
      args.push('--resume', input.sessionId)
    }
    else {
      args.push('--session-id', input.sessionId)
    }

    const workflow = getSystemWorkflow()
    if (workflow) {
      args.push('--append-system-prompt', workflow)
    }
  }

  if (!ptyRuntime.isRunning(input.sessionId)) {
    ptyTimeline.reset(input.sessionId)
  }

  ptyRuntime.ensureSession({
    sessionId: input.sessionId,
    executable: config.executable,
    args,
    cwd: context.workspace.path,
    cols: input.cols,
    rows: input.rows,
    env: {
      ...config.env,
      CRADLE_CHAT_SESSION_ID: input.sessionId,
      CRADLE_WORKSPACE_ID: context.session.workspaceId,
    },
  })

  if (!context.session.ptyStartedAt) {
    db().update(sessions)
      .set({ ptyStartedAt: Math.floor(Date.now() / 1000) })
      .where(eq(sessions.id, input.sessionId))
      .run()
  }

  return { sessionId: input.sessionId, running: ptyRuntime.isRunning(input.sessionId) }
}

export function openChatSocket(input: { sessionId: string, fromSeq?: number, ws: PtyLiveSocket }): void {
  requireSession(input.sessionId)
  requireTimelineSession(input.sessionId, 'Terminal session not found')
  ptySocketHub.open(input.ws, {
    channelId: input.sessionId,
    fromSeq: input.fromSeq,
  })
}

export function rejectSocket(ws: PtyLiveSocket, error: unknown): void {
  ptySocketHub.reject(ws, error)
}

export function handleSocketMessage(ws: PtyLiveSocket, event: PtyClientEvent): void {
  ptySocketHub.handleMessage(ws, event)
}

export function closeSocket(ws: PtyLiveSocket): void {
  ptySocketHub.close(ws)
}

export function stop(sessionId: string): void {
  requireSession(sessionId)
  ptyRuntime.destroy(sessionId)
}

export function startShell(input: { ptyId: string, cwd: string, cols: number, rows: number }) {
  if (!ptyRuntime.isRunning(input.ptyId)) {
    ptyTimeline.reset(input.ptyId)
  }

  ptyRuntime.ensureSession({
    sessionId: input.ptyId,
    executable: process.env.SHELL ?? '/bin/sh',
    args: [],
    cwd: input.cwd,
    cols: input.cols,
    rows: input.rows,
  })

  scheduleShellLeaseExpiry(input.ptyId)
  return { ptyId: input.ptyId, running: ptyRuntime.isRunning(input.ptyId) }
}

export function openShellSocket(input: { ptyId: string, fromSeq?: number, ws: PtyLiveSocket }): void {
  requireTimelineSession(input.ptyId, 'Shell session not found')
  cancelShellLeaseExpiry(input.ptyId)
  ptySocketHub.open(input.ws, {
    channelId: input.ptyId,
    fromSeq: input.fromSeq,
    onClose: () => {
      scheduleShellLeaseExpiry(input.ptyId)
    },
  })
}

export function shellStop(ptyId: string): void {
  cancelShellLeaseExpiry(ptyId)
  ptyRuntime.destroy(ptyId)
}

export function destroyPtySession(sessionId: string): void {
  cancelShellLeaseExpiry(sessionId)
  ptyRuntime.destroy(sessionId)
}

export function shutdownPtyModule(): void {
  for (const timer of shellLeaseTimers.values()) {
    clearTimeout(timer)
  }
  shellLeaseTimers.clear()
  ptySocketHub.clear()
  ptyRuntime.destroyAll()
  ptyTimeline.clear()
}

function scheduleShellLeaseExpiry(ptyId: string): void {
  cancelShellLeaseExpiry(ptyId)
  if (!ptyTimeline.hasSession(ptyId)) {
    return
  }

  const timer = setTimeout(() => {
    shellLeaseTimers.delete(ptyId)
    ptyRuntime.destroy(ptyId)
  }, getShellLeaseMs())
  shellLeaseTimers.set(ptyId, timer)
}

function cancelShellLeaseExpiry(ptyId: string): void {
  const timer = shellLeaseTimers.get(ptyId)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  shellLeaseTimers.delete(ptyId)
}

function getShellLeaseMs(): number {
  const value = Number.parseInt(process.env.CRADLE_PTY_SHELL_LEASE_MS ?? '', 10)
  if (Number.isFinite(value) && value > 0) {
    return value
  }
  return 15_000
}
