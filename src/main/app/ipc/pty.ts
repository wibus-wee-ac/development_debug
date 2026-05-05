// Input: IpcService base, PtyManager singleton, agentProfiles + sessions + workspaces DB tables
// Output: PtyService IPC handler — starts/stops/writes/resizes PTY sessions for cli-tui agents
// Position: Main-process service registered in src/main/index.ts

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq } from 'drizzle-orm'

import { getDb } from '../../db'
import { agentProfiles, sessions, workspaces } from '../../db/schema'
import { PtyManager } from '../../platform/pty/pty-manager'

export class PtyService extends IpcService {
  static readonly groupName = 'pty'

  /**
   * Start a PTY process for the given Cradle session.
   * Resolves cwd from the session's workspace. Looks up CLI-TUI profile cmd/args.
   */
  @IpcMethod()
  startPty(sessionId: string, cols: number, rows: number): void {
    const db = getDb()
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const workspace = db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
    const cwd = workspace?.path ?? process.env.HOME ?? '.'
    const profile = db.select().from(agentProfiles).where(eq(agentProfiles.id, session.agentProfileId)).get()
    if (!profile || profile.providerKind !== 'cli-tui') {
      throw new Error(`CLI-TUI agent profile not found: ${session.agentProfileId}`)
    }
    const config = readCliConfig(profile.configJson)
    PtyManager.getInstance().start(sessionId, config.executable, config.args, cwd, cols, rows)
  }

  /** Stop (kill) the PTY process for the given session. No-op if not running. */
  @IpcMethod()
  stopPty(sessionId: string): void {
    PtyManager.getInstance().stop(sessionId)
  }

  /** Write raw bytes (keyboard input) to the PTY's stdin. */
  @IpcMethod()
  writePty(sessionId: string, data: string): void {
    PtyManager.getInstance().write(sessionId, data)
  }

  /** Resize the PTY to the given dimensions. Call when the terminal view resizes. */
  @IpcMethod()
  resizePty(sessionId: string, cols: number, rows: number): void {
    PtyManager.getInstance().resize(sessionId, cols, rows)
  }

  /** Return true if a PTY process is alive for the given session. */
  @IpcMethod()
  isPtyRunning(sessionId: string): boolean {
    return PtyManager.getInstance().isRunning(sessionId)
  }

  /** Return the accumulated output buffer for a session (for xterm replay on reconnect). */
  @IpcMethod()
  getPtyBuffer(sessionId: string): string {
    return PtyManager.getInstance().getBuffer(sessionId)
  }

  /**
   * Start a plain interactive shell PTY (e.g., for the bottom panel).
   * Uses $SHELL (falling back to /bin/sh). Idempotent — no-op if already running.
   */
  @IpcMethod()
  startShell(ptyId: string, cwd: string, cols: number, rows: number): void {
    const shell = process.env.SHELL ?? '/bin/sh'
    PtyManager.getInstance().start(ptyId, shell, [], cwd, cols, rows)
  }
}

function readCliConfig(configJson: string): { executable: string, args: string[] } {
  try {
    const parsed = JSON.parse(configJson) as { executable?: unknown, args?: unknown }
    return {
      executable: typeof parsed.executable === 'string' ? parsed.executable : '/bin/sh',
      args: Array.isArray(parsed.args) ? parsed.args.filter((arg): arg is string => typeof arg === 'string') : [],
    }
  }
  catch {
    return { executable: '/bin/sh', args: [] }
  }
}
