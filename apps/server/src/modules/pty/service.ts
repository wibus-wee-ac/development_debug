import type { Workspace } from '@cradle/db'
import { sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import {
  type CodexCliSessionBinding,
  SessionRuntimeConfigJsonSchema,
  writeCodexCliSessionBindingToSessionConfig
} from '../../helpers/agent-runtime-config'
import { getSystemWorkflow } from '../../helpers/system-workflow'
import { db } from '../../infra'
import * as SessionService from '../session/service'
import type { PtyClientEvent } from './protocol'
import { captureCodexCliSession } from './codex-session-capture'
import { PtyRuntimeRegistry } from './pty.runtime'
import type { PtyLiveSocket } from './pty.socket'
import { PtySocketHub } from './pty.socket'
import { ptyTimeline } from './pty.timeline'

const shellLeaseTimers = new Map<string, ReturnType<typeof setTimeout>>()
const codexCaptureTimers = new Map<string, ReturnType<typeof setTimeout>>()
const CODEX_CAPTURE_ATTEMPTS = 12
const CODEX_CAPTURE_RETRY_MS = 500
const CODEX_VALUE_OPTIONS = new Set([
  '-a',
  '-c',
  '-C',
  '-i',
  '-m',
  '-p',
  '-s',
  '--add-dir',
  '--ask-for-approval',
  '--cd',
  '--config',
  '--image',
  '--local-provider',
  '--model',
  '--profile',
  '--remote',
  '--remote-auth-token-env',
  '--sandbox',
])

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
  }
})

const ptySocketHub = new PtySocketHub(ptyRuntime, ptyTimeline)

SessionService.onSessionCleanup((sessionId) => {
  cancelShellLeaseExpiry(sessionId)
  cancelCodexSessionCapture(sessionId)
  ptyRuntime.destroy(sessionId)
})

export interface TerminalSessionContext {
  session: TerminalSessionRecord
  workspace: Workspace
}

interface TerminalSessionRecord {
  id: string
  workspaceId: string | null
  agentProfileId: string | null
  runtimeKind: string
  configJson: string
  ptyStartedAt: number | null
}

function getSession(sessionId: string): TerminalSessionRecord | undefined {
  return db()
    .select({
      id: sessions.id,
      workspaceId: sessions.workspaceId,
      agentProfileId: sessions.agentProfileId,
      runtimeKind: sessions.runtimeKind,
      configJson: sessions.configJson,
      ptyStartedAt: sessions.ptyStartedAt
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
}

function getTerminalContext(sessionId: string): TerminalSessionContext | null {
  const session = getSession(sessionId)
  if (!session) {
    return null
  }

  const workspace = session.workspaceId
    ? db().select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
    : undefined
  if (!workspace) {
    return null
  }

  return { session, workspace }
}

function requireSession(sessionId: string): TerminalSessionRecord {
  const session = getSession(sessionId)
  if (!session) {
    throw new AppError({
      code: 'terminal_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }
  return session
}

function requireTerminalContext(sessionId: string): TerminalSessionContext {
  const context = getTerminalContext(sessionId)
  if (!context) {
    throw new AppError({
      code: 'terminal_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }
  return context
}

function requireTimelineSession(sessionId: string, message: string): void {
  if (!ptyTimeline.hasSession(sessionId)) {
    throw new AppError({ code: 'terminal_not_found', status: 404, message, details: { sessionId } })
  }
}

function isClaudeCli(executable: string): boolean {
  const base = executable.split('/').pop() ?? ''
  return base === 'claude' || base.startsWith('claude-')
}

function isCodexCli(executable: string): boolean {
  const base = executable.split('/').pop() ?? ''
  return base === 'codex' || base.startsWith('codex-')
}

function hasCodexPositionalArg(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) {
      continue
    }
    if (arg === '--') {
      return index < args.length - 1
    }
    if (!arg.startsWith('-')) {
      return true
    }
    if (arg.includes('=')) {
      continue
    }
    if (CODEX_VALUE_OPTIONS.has(arg)) {
      index += 1
    }
  }
  return false
}

export function startOrAttach(input: { sessionId: string; cols: number; rows: number }) {
  const context = requireTerminalContext(input.sessionId)
  if (context.session.runtimeKind !== 'cli-tui') {
    throw new AppError({
      code: 'terminal_profile_not_supported',
      status: 409,
      message: 'Terminal runtime only supports cli-tui sessions',
      details: { sessionId: input.sessionId, runtimeKind: context.session.runtimeKind }
    })
  }

  const sessionConfig = SessionRuntimeConfigJsonSchema.parse(context.session.configJson)
  const config = sessionConfig.cliTuiLaunch
  if (!config) {
    throw new AppError({
      code: 'terminal_launch_config_missing',
      status: 409,
      message: 'Terminal launch configuration is missing for this session',
      details: { sessionId: input.sessionId }
    })
  }
  const args = [...config.args]
  const running = ptyRuntime.isRunning(input.sessionId)
  let shouldCaptureCodexSession = false

  if (isClaudeCli(config.executable)) {
    if (context.session.ptyStartedAt) {
      args.push('--resume', input.sessionId)
    } else {
      args.push('--session-id', input.sessionId)
    }

    const workflow = getSystemWorkflow()
    if (workflow) {
      args.push('--append-system-prompt', workflow)
    }
  }
  else if (isCodexCli(config.executable)) {
    const binding = sessionConfig.codexCliSession
    const autoResumeAllowed = !hasCodexPositionalArg(args)
    const bindingMatchesWorkspace = binding?.workspacePath === context.workspace.path
    if (!running && autoResumeAllowed && bindingMatchesWorkspace) {
      args.push('resume', binding.sessionId)
    }
    shouldCaptureCodexSession = !running && autoResumeAllowed && !bindingMatchesWorkspace
  }

  if (!running) {
    ptyTimeline.reset(input.sessionId)
  }

  const startedAt = Date.now()
  ptyRuntime.ensureSession({
    sessionId: input.sessionId,
    role: 'cli-tui',
    executable: config.executable,
    args,
    cwd: context.workspace.path,
    cols: input.cols,
    rows: input.rows,
    env: {
      ...config.env,
      CRADLE_CHAT_SESSION_ID: input.sessionId,
      ...(context.session.workspaceId ? { CRADLE_WORKSPACE_ID: context.session.workspaceId } : {})
    }
  })

  if (!context.session.ptyStartedAt) {
    db()
      .update(sessions)
      .set({ ptyStartedAt: Math.floor(Date.now() / 1000) })
      .where(eq(sessions.id, input.sessionId))
      .run()
  }

  if (shouldCaptureCodexSession) {
    scheduleCodexSessionCapture({
      sessionId: input.sessionId,
      workspacePath: context.workspace.path,
      startedAt,
    })
  }

  return { sessionId: input.sessionId, running: ptyRuntime.isRunning(input.sessionId) }
}

export function openChatSocket(input: {
  sessionId: string
  fromSeq?: number
  ws: PtyLiveSocket
}): void {
  requireSession(input.sessionId)
  requireTimelineSession(input.sessionId, 'Terminal session not found')
  ptySocketHub.open(input.ws, {
    channelId: input.sessionId,
    fromSeq: input.fromSeq
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
  cancelCodexSessionCapture(sessionId)
  ptyRuntime.destroy(sessionId)
}

export function startShell(input: { ptyId: string; cwd: string; cols: number; rows: number }) {
  if (!ptyRuntime.isRunning(input.ptyId)) {
    ptyTimeline.reset(input.ptyId)
  }

  ptyRuntime.ensureSession({
    sessionId: input.ptyId,
    role: 'bottom-panel',
    executable: process.env.SHELL ?? '/bin/sh',
    args: [],
    cwd: input.cwd,
    cols: input.cols,
    rows: input.rows
  })

  scheduleShellLeaseExpiry(input.ptyId)
  return { ptyId: input.ptyId, running: ptyRuntime.isRunning(input.ptyId) }
}

export function openShellSocket(input: {
  ptyId: string
  fromSeq?: number
  ws: PtyLiveSocket
}): void {
  requireTimelineSession(input.ptyId, 'Shell session not found')
  cancelShellLeaseExpiry(input.ptyId)
  ptySocketHub.open(input.ws, {
    channelId: input.ptyId,
    fromSeq: input.fromSeq,
    onClose: () => {
      scheduleShellLeaseExpiry(input.ptyId)
    }
  })
}

export function shellStop(ptyId: string): void {
  cancelShellLeaseExpiry(ptyId)
  ptyRuntime.destroy(ptyId)
}

export function destroyPtySession(sessionId: string): void {
  cancelShellLeaseExpiry(sessionId)
  cancelCodexSessionCapture(sessionId)
  ptyRuntime.destroy(sessionId)
}

export function shutdownPtyModule(): void {
  for (const timer of shellLeaseTimers.values()) {
    clearTimeout(timer)
  }
  shellLeaseTimers.clear()
  for (const timer of codexCaptureTimers.values()) {
    clearTimeout(timer)
  }
  codexCaptureTimers.clear()
  ptySocketHub.clear()
  ptyRuntime.destroyAll()
  ptyTimeline.clear()
}

export async function listResources() {
  const terminals = await ptyRuntime.snapshotResources()
  const totals = terminals.reduce(
    (acc, item) => {
      if (item.rssMB === null) {
        return acc
      }

      if (item.role === 'cli-tui') {
        acc.cliTuiRssMB += item.rssMB
      } else {
        acc.bottomPanelRssMB += item.rssMB
      }

      return acc
    },
    {
      cliTuiRssMB: 0,
      bottomPanelRssMB: 0
    }
  )

  return {
    terminals,
    totals: {
      cliTuiRssMB: Math.round(totals.cliTuiRssMB * 100) / 100,
      bottomPanelRssMB: Math.round(totals.bottomPanelRssMB * 100) / 100
    },
    timestamp: Date.now()
  }
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

function scheduleCodexSessionCapture(input: {
  sessionId: string
  workspacePath: string
  startedAt: number
}): void {
  cancelCodexSessionCapture(input.sessionId)
  let attempts = 0

  const runCapture = async () => {
    attempts += 1
    try {
      const binding = await captureCodexCliSession({
        workspacePath: input.workspacePath,
        startedAt: input.startedAt,
      })
      if (binding) {
        persistCodexSessionBinding(input.sessionId, binding)
        codexCaptureTimers.delete(input.sessionId)
        return
      }
    }
    catch {
      // Capture is opportunistic; a failed scan should not break the PTY session.
    }

    if (attempts >= CODEX_CAPTURE_ATTEMPTS || !ptyRuntime.hasSession(input.sessionId)) {
      codexCaptureTimers.delete(input.sessionId)
      return
    }

    const timer = setTimeout(() => {
      void runCapture()
    }, CODEX_CAPTURE_RETRY_MS)
    codexCaptureTimers.set(input.sessionId, timer)
  }

  void runCapture()
}

function cancelCodexSessionCapture(sessionId: string): void {
  const timer = codexCaptureTimers.get(sessionId)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  codexCaptureTimers.delete(sessionId)
}

function persistCodexSessionBinding(
  sessionId: string,
  binding: CodexCliSessionBinding
): void {
  const session = getSession(sessionId)
  if (!session) {
    return
  }
  const existing = SessionRuntimeConfigJsonSchema.parse(session.configJson).codexCliSession
  if (existing?.workspacePath === binding.workspacePath) {
    return
  }

  db()
    .update(sessions)
    .set({
      configJson: writeCodexCliSessionBindingToSessionConfig({
        configJson: session.configJson,
        binding,
      })
    })
    .where(eq(sessions.id, sessionId))
    .run()
}

function getShellLeaseMs(): number {
  const value = Number.parseInt(process.env.CRADLE_PTY_SHELL_LEASE_MS ?? '', 10)
  if (Number.isFinite(value) && value > 0) {
    return value
  }
  return 15_000
}
