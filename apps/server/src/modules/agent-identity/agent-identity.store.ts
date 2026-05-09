// Input: DbAccessor + agent identity tables
// Output: agent identity CRUD store
// Position: apps/server/src/modules/agent-identity/agent-identity.store.ts

import { randomUUID } from 'node:crypto'

import { agents } from '@cradle/db'
import type { Agent } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'

export interface AgentListFilters {
  enabled?: boolean
  agentProfileId?: string
}

export interface CreateAgentRecord {
  name: string
  description: string | null
  avatarUrl: string
  avatarStyle: string
  avatarSeed: string
  agentProfileId: string
  modelId: string | null
  thinkingEffort: 'low' | 'medium' | 'high' | 'auto'
  configJson: string
}

export interface UpdateAgentRecord {
  name?: string
  description?: string | null
  avatarUrl?: string
  avatarStyle?: string
  avatarSeed?: string
  agentProfileId?: string
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto'
  configJson?: string
  enabled?: boolean
}

@injectable()
export class AgentIdentityStore {
  constructor(private readonly dbAccessor: DbAccessor) {}

  list(filters: AgentListFilters = {}): Agent[] {
    const clauses: SQL[] = []
    if (filters.enabled !== undefined) {
      clauses.push(eq(agents.enabled, filters.enabled))
    }
    if (filters.agentProfileId) {
      clauses.push(eq(agents.agentProfileId, filters.agentProfileId))
    }

    const db = this.dbAccessor.get().select().from(agents)
    if (clauses.length === 0) {
      return db.orderBy(desc(agents.updatedAt)).all()
    }

    return db.where(clauses.length === 1 ? clauses[0]! : and(...clauses)).orderBy(desc(agents.updatedAt)).all()
  }

  get(id: string): Agent | undefined {
    return this.dbAccessor.get().select().from(agents).where(eq(agents.id, id)).get()
  }

  create(input: CreateAgentRecord): Agent {
    const id = randomUUID()
    return this.dbAccessor
      .get()
      .insert(agents)
      .values({
        id,
        name: input.name,
        description: input.description,
        avatarUrl: input.avatarUrl,
        avatarStyle: input.avatarStyle,
        avatarSeed: input.avatarSeed,
        agentProfileId: input.agentProfileId,
        modelId: input.modelId,
        thinkingEffort: input.thinkingEffort,
        configJson: input.configJson,
        enabled: true,
      })
      .returning()
      .get()
  }

  update(id: string, patch: UpdateAgentRecord): Agent | undefined {
    const now = Math.floor(Date.now() / 1000)
    return this.dbAccessor
      .get()
      .update(agents)
      .set({ ...patch, updatedAt: now })
      .where(eq(agents.id, id))
      .returning()
      .get()
  }

  delete(id: string): void {
    this.dbAccessor.get().delete(agents).where(eq(agents.id, id)).run()
  }
}
