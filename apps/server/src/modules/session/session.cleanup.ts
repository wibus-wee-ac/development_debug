// Input: session deletion events
// Output: cleanup adapter (no-op)
// Position: apps/server/src/modules/session/session.cleanup.ts

import { inject, injectable } from 'tsyringe'

import { PtySessionManager } from '../pty/pty.manager'

@injectable()
export class SessionCleanup {
  constructor(@inject(PtySessionManager) private readonly terminals: PtySessionManager) {}

  onSessionDeleted(sessionId: string): void {
    this.terminals.destroy(sessionId)
  }
}
