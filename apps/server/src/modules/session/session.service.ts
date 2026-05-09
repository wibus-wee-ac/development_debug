// Input: SessionStore + SessionExport + SessionCleanup
// Output: session module semantics
// Position: apps/server/src/modules/session/session.service.ts

import type { Message, Session } from '@cradle/db'
import { inject, injectable } from 'tsyringe'

import { SessionCleanup } from './session.cleanup'
import { SessionExport } from './session.export'
import { SessionStore } from './session.store'

@injectable()
export class SessionService {
  constructor(
    @inject(SessionStore) private readonly store: SessionStore,
    @inject(SessionExport) private readonly exporter: SessionExport,
    @inject(SessionCleanup) private readonly cleanup: SessionCleanup,
  ) {}

  list(workspaceId: string): Session[] {
    return this.store.list(workspaceId)
  }

  get(id: string): Session | null {
    return this.store.get(id) ?? null
  }

  create(input: {
    id?: string
    workspaceId: string
    title: string
    agentProfileId: string
    agentId?: string | null
    linkedIssueId?: string | null
  }): Session {
    return this.store.create(input)
  }

  update(input: { id: string, title?: string, pinned?: boolean }): Session | null {
    return this.store.update(input) ?? null
  }

  updateTitle(input: { id: string, title: string }): void {
    this.update(input)
  }

  delete(id: string): void {
    this.cleanup.onSessionDeleted(id)
    this.store.delete(id)
  }

  deleteByAgentProfile(agentProfileId: string): void {
    for (const sessionId of this.store.listIdsByAgentProfile(agentProfileId)) {
      this.delete(sessionId)
    }
  }

  getMessages(sessionId: string): Message[] {
    return this.store.getMessages(sessionId)
  }

  exportMarkdown(sessionId: string): string {
    return this.exporter.exportMarkdown(sessionId)
  }
}
