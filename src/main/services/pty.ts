// Input: IpcService base, PtyManager singleton, cliAgents + sessions + workspaces DB tables
// Output: PtyService IPC handler — starts/stops/writes/resizes PTY sessions for cli-tui agents
// Position: Main-process service registered in src/main/index.ts

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq } from 'drizzle-orm'

import { getDb } from '../db'
import { cliAgents, sessions, workspaces } from '../db/schema'
import { PtyManager } from '../lib/pty-manager'

export class PtyService extends IpcService {
  static readonly groupName = 'pty'

  /**
   * Start a PTY process for the given Cradle session.
   * Resolves cwd from the session's workspace. Looks up CLI agent cmd/args.
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
    const agent = db.select().from(cliAgents).where(eq(cliAgents.id, session.agent)).get()
    if (!agent) {
      throw new Error(`CLI agent not found: ${session.agent}`)
    }
    const extraArgs: string[] = agent.args ? (JSON.parse(agent.args) as string[]) : []
    PtyManager.getInstance().start(sessionId, agent.executable, extraArgs, cwd, cols, rows)
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
