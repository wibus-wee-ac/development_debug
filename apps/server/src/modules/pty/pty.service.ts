// Input: terminal-session store and runtime manager
// Output: session-owned terminal runtime semantics for cli-tui sessions
// Position: apps/server/src/modules/pty/pty.service.ts

import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { cliTuiConfigSchema } from '../../helpers/provider-config-schemas'
import { PtySessionManager } from './pty.manager'
import { PtyStore } from './pty.store'

@injectable()
export class PtyService {
  constructor(
    @inject(PtyStore) private readonly store: PtyStore,
    @inject(PtySessionManager) private readonly manager: PtySessionManager,
  ) {}

  startOrAttach(input: { sessionId: string, cols: number, rows: number }) {
    const context = this.requireTerminalContext(input.sessionId)
    if (context.profile.providerKind !== 'cli-tui') {
      throw new AppError({
        code: 'terminal_profile_not_supported',
        status: 409,
        message: 'Terminal runtime only supports cli-tui profiles',
        details: { sessionId: input.sessionId, providerKind: context.profile.providerKind },
      })
    }

    const config = readCliConfig(context.profile.configJson)
    this.manager.startOrAttach({
      sessionId: input.sessionId,
      executable: config.executable,
      args: config.args,
      cwd: context.workspace.path,
      cols: input.cols,
      rows: input.rows,
      env: config.env,
    })

    return {
      sessionId: input.sessionId,
      running: this.manager.isRunning(input.sessionId),
    }
  }

  openStream(sessionId: string): ReadableStream<Uint8Array> {
    this.requireSession(sessionId)
    if (!this.manager.hasSession(sessionId)) {
      throw new AppError({
        code: 'terminal_not_found',
        status: 404,
        message: 'Terminal session not found',
        details: { sessionId },
      })
    }
    return this.manager.openStream(sessionId)
  }

  writeInput(input: { sessionId: string, data: string }): void {
    this.requireSession(input.sessionId)
    if (!this.manager.write(input.sessionId, input.data)) {
      throw new AppError({
        code: 'terminal_not_running',
        status: 409,
        message: 'Terminal session is not running',
        details: { sessionId: input.sessionId },
      })
    }
  }

  resize(input: { sessionId: string, cols: number, rows: number }): void {
    this.requireSession(input.sessionId)
    if (!this.manager.resize(input.sessionId, input.cols, input.rows)) {
      throw new AppError({
        code: 'terminal_not_running',
        status: 409,
        message: 'Terminal session is not running',
        details: { sessionId: input.sessionId },
      })
    }
  }

  stop(sessionId: string): void {
    this.requireSession(sessionId)
    this.manager.destroy(sessionId)
  }

  cleanupSession(sessionId: string): void {
    this.manager.destroy(sessionId)
  }

  private requireSession(sessionId: string) {
    const session = this.store.getSession(sessionId)
    if (!session) {
      throw new AppError({
        code: 'terminal_session_not_found',
        status: 404,
        message: 'Chat session not found',
        details: { sessionId },
      })
    }
    return session
  }

  private requireTerminalContext(sessionId: string) {
    const context = this.store.getTerminalContext(sessionId)
    if (!context) {
      throw new AppError({
        code: 'terminal_session_not_found',
        status: 404,
        message: 'Chat session not found',
        details: { sessionId },
      })
    }
    return context
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
    return {
      executable: process.env.SHELL ?? '/bin/sh',
      args: [],
    }
  }
}
