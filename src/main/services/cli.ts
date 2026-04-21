// Input: IpcService base, DB schema (cliAgents), drizzle-orm, node:child_process
// Output: CliService IPC handler — CRUD for user-configured CLI agents + auto-detect known CLIs
// Position: Main-process service for cli-tui provider agent management

import { execFileSync } from 'node:child_process'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq } from 'drizzle-orm'

import { getDb } from '../db'
import type { CliAgent, NewCliAgent } from '../db/schema'
import { cliAgents } from '../db/schema'

/** Known CLI tools to probe when the user runs auto-detect. */
const KNOWN_CLIS = [
  { id: 'claude-code', name: 'Claude Code', executable: 'claude' },
  { id: 'openai-codex', name: 'OpenAI Codex', executable: 'codex' },
  { id: 'opencode', name: 'OpenCode', executable: 'opencode' },
] as const

function which(bin: string): string | null {
  try {
    const result = execFileSync('which', [bin], { encoding: 'utf8', timeout: 3000 }).trim()
    return result || null
  }
  catch {
    return null
  }
}

export interface DetectedCli {
  id: string
  name: string
  executable: string
  path: string
  alreadyAdded: boolean
}

export class CliService extends IpcService {
  static readonly groupName = 'cli'

  /** List all configured CLI agents. */
  @IpcMethod()
  listAgents(): CliAgent[] {
    return getDb().select().from(cliAgents).all()
  }

  /** Get a single CLI agent by id. */
  @IpcMethod()
  getAgent(id: string): CliAgent | undefined {
    return getDb().select().from(cliAgents).where(eq(cliAgents.id, id)).get()
  }

  /** Add or update a CLI agent configuration. */
  @IpcMethod()
  upsertAgent(agent: NewCliAgent): CliAgent {
    const now = Math.floor(Date.now() / 1000)
    getDb()
      .insert(cliAgents)
      .values({ ...agent, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: cliAgents.id,
        set: {
          name: agent.name,
          executable: agent.executable,
          args: agent.args,
          updatedAt: now,
        },
      })
      .run()
    return getDb().select().from(cliAgents).where(eq(cliAgents.id, agent.id)).get()!
  }

  /** Remove a CLI agent configuration. */
  @IpcMethod()
  removeAgent(id: string): void {
    getDb().delete(cliAgents).where(eq(cliAgents.id, id)).run()
  }

  /**
   * Probe the system PATH for known CLI tools (claude, codex, opencode).
   * Returns detected entries along with whether each is already registered.
   */
  @IpcMethod()
  detect(): DetectedCli[] {
    const installed = new Set(getDb().select().from(cliAgents).all().map(a => a.id))
    const results: DetectedCli[] = []
    for (const cli of KNOWN_CLIS) {
      const path = which(cli.executable)
      if (path) {
        results.push({
          id: cli.id,
          name: cli.name,
          executable: cli.executable,
          path,
          alreadyAdded: installed.has(cli.id),
        })
      }
    }
    return results
  }
}
