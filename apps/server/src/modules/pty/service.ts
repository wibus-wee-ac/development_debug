import type { AgentProfile, Session, Workspace } from '@cradle/db'
import { agentProfiles, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { cliTuiConfigSchema } from '../../helpers/provider-config-schemas'
import { db } from '../../infra'
import * as SessionService from '../session/service'
import { ptyManager } from './pty.manager'

// Register cleanup hook so deleting a session stops its terminal
SessionService.onSessionCleanup((sessionId) => {
  ptyManager.destroy(sessionId)
})

// ── DB queries ──

export interface TerminalSessionContext {
  session: Session
  workspace: Workspace
  profile: AgentProfile
}

function getSession(sessionId: string): Session | undefined {
  return db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
}

function getTerminalContext(sessionId: string): TerminalSessionContext | null {
  const session = getSession(sessionId)
  if (!session) {
    return null
  }
  const workspace = db().select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
  const profile = db().select().from(agentProfiles).where(eq(agentProfiles.id, session.agentProfileId)).get()
  if (!workspace || !profile) {
    return null
  }
  return { session, workspace, profile }
}

// ── helpers ──

function requireSession(sessionId: string): Session {
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

// ── public API ──

export function startOrAttach(input: { sessionId: string, cols: number, rows: number }) {
  const context = requireTerminalContext(input.sessionId)
  if (context.profile.providerKind !== 'cli-tui') {
    throw new AppError({
      code: 'terminal_profile_not_supported',
      status: 409,
      message: 'Terminal runtime only supports cli-tui profiles',
      details: { sessionId: input.sessionId, providerKind: context.profile.providerKind },
    })
  }

  const config = readCliConfig(context.profile.configJson)
  ptyManager.startOrAttach({
    sessionId: input.sessionId,
    executable: config.executable,
    args: config.args,
    cwd: context.workspace.path,
    cols: input.cols,
    rows: input.rows,
    env: config.env,
  })

  return { sessionId: input.sessionId, running: ptyManager.isRunning(input.sessionId) }
}

export function openStream(sessionId: string): ReadableStream<Uint8Array> {
  requireSession(sessionId)
  if (!ptyManager.hasSession(sessionId)) {
    throw new AppError({ code: 'terminal_not_found', status: 404, message: 'Terminal session not found', details: { sessionId } })
  }
  return ptyManager.openStream(sessionId)
}

export function writeInput(input: { sessionId: string, data: string }): void {
  requireSession(input.sessionId)
  if (!ptyManager.write(input.sessionId, input.data)) {
    throw new AppError({ code: 'terminal_not_running', status: 409, message: 'Terminal session is not running', details: { sessionId: input.sessionId } })
  }
}

export function resize(input: { sessionId: string, cols: number, rows: number }): void {
  requireSession(input.sessionId)
  if (!ptyManager.resize(input.sessionId, input.cols, input.rows)) {
    throw new AppError({ code: 'terminal_not_running', status: 409, message: 'Terminal session is not running', details: { sessionId: input.sessionId } })
  }
}

export function stop(sessionId: string): void {
  requireSession(sessionId)
  ptyManager.destroy(sessionId)
}

export function startShell(input: { ptyId: string, cwd: string, cols: number, rows: number }) {
  ptyManager.startOrAttach({
    sessionId: input.ptyId,
    executable: process.env.SHELL ?? '/bin/sh',
    args: [],
    cwd: input.cwd,
    cols: input.cols,
    rows: input.rows,
  })
  return { sessionId: input.ptyId, running: ptyManager.isRunning(input.ptyId) }
}

export function shellStream(ptyId: string): ReadableStream<Uint8Array> {
  if (!ptyManager.hasSession(ptyId)) {
    throw new AppError({ code: 'terminal_not_found', status: 404, message: 'Shell session not found', details: { sessionId: ptyId } })
  }
  return ptyManager.openStream(ptyId)
}

export function shellInput(ptyId: string, data: string): void {
  if (!ptyManager.write(ptyId, data)) {
    throw new AppError({ code: 'terminal_not_running', status: 409, message: 'Shell session is not running', details: { sessionId: ptyId } })
  }
}

export function shellResize(ptyId: string, cols: number, rows: number): void {
  if (!ptyManager.resize(ptyId, cols, rows)) {
    throw new AppError({ code: 'terminal_not_running', status: 409, message: 'Shell session is not running', details: { sessionId: ptyId } })
  }
}

export function shellStop(ptyId: string): void {
  ptyManager.destroy(ptyId)
}

/** Called by session cleanup — does not require session to exist in DB. */
export function destroyPtySession(sessionId: string): void {
  ptyManager.destroy(sessionId)
}
